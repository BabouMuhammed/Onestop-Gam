/** Full adapter rehearsal. Accepts ONLY an explicitly configured isolated test database. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { prisma, Decimal } from '../src/db'
import { env } from '../src/env'
import { hashPassword } from '../src/auth/password'
import { prepareOpeningPlan, openingProductKey, runOpeningImport } from './opening-stock-plan'
import { createPrismaOpeningStore } from './opening-stock-store'
import { assertOpeningTarget } from './opening-stock-target'

const root = fileURLToPath(new URL('../../../', import.meta.url))
async function main() {
  assert(env.NODE_ENV === 'test' && env.DATABASE_URL === process.env.TEST_DATABASE_URL, 'Rehearsal requires explicit matching test-only environment')
  const paths = process.argv.slice(2).map(p => resolve(root,p))
  assert(paths.length === 2, 'Supply the two unapproved source-preview files')
  const inputs = paths.map(p => JSON.parse(readFileSync(p,'utf8')))
  const plans = inputs.map(prepareOpeningPlan)
  assert(plans.every(p => p.data.preserveSourceRows && !p.data.approval), 'Only unapproved source previews may be rehearsed')
  const [identity] = await prisma.$queryRaw<{database:string;role:string;host:string;port:number;schema:string}[]>`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_schema() AS schema`
  assertOpeningTarget(env.NODE_ENV,identity,env.DATABASE_URL)
  // No truncation/reset is used. Refuse existing test inventory instead.
  for (const model of [prisma.product,prisma.location,prisma.stockLevel,prisma.stockMovement,prisma.auditLog] as const) {
    assert(await (model.count as () => Promise<number>)() === 0, 'A fresh empty rehearsal database is required')
  }
  assert(await prisma.division.count() === 0, 'Rehearsal divisions must be created fresh')
  await prisma.division.createMany({data:[{code:'QUALITY_FOODS',name:'Quality Foods',skuPrefix:'QF'},{code:'LE_GAYE_BI',name:'LEGAYEBI',skuPrefix:'LGB'}]})
  const store = createPrismaOpeningStore(env.DATABASE_URL)
  const simulated = inputs.map(input => ({...input,approval:{approvedBy:'TEST DATABASE REHEARSAL ONLY — NOT BUSINESS AUTHORIZATION',approvedAt:new Date().toISOString(),fingerprint:prepareOpeningPlan(input).fingerprint}}))
  const snapshot = async () => {
    const tables = ['Product','Location','StockLevel','StockMovement','AuditLog','Division']
    const rows = []
    for (const table of tables) rows.push(await prisma.$queryRawUnsafe(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) AS data FROM public."${table}" t`))
    return createHash('sha256').update(JSON.stringify(rows)).digest('hex')
  }
  const before = await snapshot()
  await prisma.$transaction(async tx => {
    const [id] = await tx.$queryRaw<typeof identity[]>`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_schema() AS schema`
    assertOpeningTarget(env.NODE_ENV,id,env.DATABASE_URL)
    await tx.$executeRawUnsafe(`CREATE FUNCTION public.opening_rehearsal_fault() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='stock.opening_imported' AND NEW."divisionId"=(SELECT id FROM "Division" WHERE code='QUALITY_FOODS') THEN
      RAISE EXCEPTION 'Intentional second-division rehearsal rollback'; END IF; RETURN NEW; END $$`)
    await tx.$executeRawUnsafe('CREATE TRIGGER opening_rehearsal_fault BEFORE INSERT ON public."AuditLog" FOR EACH ROW EXECUTE FUNCTION public.opening_rehearsal_fault()')
  })
  try { await assert.rejects(runOpeningImport(simulated,store,true)) }
  finally {
    await prisma.$transaction(async tx => {
      const [id] = await tx.$queryRaw<typeof identity[]>`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_schema() AS schema`
      assertOpeningTarget(env.NODE_ENV,id,env.DATABASE_URL)
      await tx.$executeRawUnsafe('DROP TRIGGER opening_rehearsal_fault ON public."AuditLog"')
      await tx.$executeRawUnsafe('DROP FUNCTION public.opening_rehearsal_fault()')
    })
  }
  assert.equal(await snapshot(),before,'Both divisions, SKU counters and every stock/audit row must roll back')
  const imported = await runOpeningImport(simulated,store,true)
  assert(imported.every(p => p.status === 'imported'))
  const committed = await snapshot()
  const replay = await runOpeningImport(simulated,store,true)
  assert(replay.every(p => p.status === 'already_imported'))
  for (const result of await Promise.all([runOpeningImport(simulated,store,true),runOpeningImport(simulated,store,true)])) assert(result.every(p=>p.status === 'already_imported'))
  assert.equal(await snapshot(),committed,'Retries must leave every persisted row unchanged')
  await assert.rejects(runOpeningImport([{...simulated[0],items:[...simulated[0].items,simulated[0].items[0]]},simulated[1]],store,true),/Duplicate|Repeated/)
  assert.equal(await snapshot(),committed)
  const reconciliation = []
  for (const plan of plans) {
    const division = await prisma.division.findUniqueOrThrow({where:{code:plan.data.division}})
    const products = await prisma.product.findMany({where:{divisionId:division.id},include:{levels:{include:{location:true}},movements:true}})
    assert.equal(products.length,plan.data.items.length)
    assert.equal(await prisma.location.count({where:{divisionId:division.id}}),plan.locations)
    for (const item of plan.data.items) {
      const key = openingProductKey(plan.data,item)
      const product = products.find(p=>p.openingSourceKey===key)
      assert(product, 'Every original source row must have an independent product')
      assert.equal(product.name,item.name); assert.equal(product.unit,item.unit)
      assert.equal(product.requiresStockReview,item.requiresStockReview)
      assert.equal(product.sellingPrice,null); assert.equal(product.costPrice,null); assert.equal(product.packSize,null)
      const source = product.openingSource as Record<string,unknown>
      for (const [field,value] of Object.entries(item.raw!)) assert.deepEqual(source[field],value)
      assert.equal(source.file,plan.data.source); assert.equal(source.sha256,plan.data.sourceSha256)
      assert.equal(product.levels.length,1); assert.equal(product.movements.length,1)
      const level=product.levels[0]!, movement=product.movements[0]!
      assert.equal(level.location.name,item.location); assert.equal(level.location.divisionId,division.id)
      assert(new Decimal(item.quantity).equals(level.quantity))
      assert(movement.quantityDelta.equals(level.quantity)); assert(movement.balanceAfter.equals(level.quantity))
      assert.equal(movement.type,'OPENING'); assert.equal(movement.divisionId,division.id); assert.equal(movement.locationId,level.locationId)
      assert.equal(movement.createdAt.toISOString().slice(0,10),plan.data.countedOn)
    }
    reconciliation.push({division:plan.data.division,products:products.length,stockLines:products.length,locations:plan.locations,
      ledgerRows:products.reduce((sum,p)=>sum+p.movements.length,0),unspecifiedUnits:products.filter(p=>p.unit==='UNSPECIFIED').length,
      reviewRequired:products.filter(p=>p.requiresStockReview).length,allSourceRowsReconciled:true})
    // Synthetic logins are confined to this rehearsal DB for browser inventory checks.
    await prisma.user.create({data:{username:plan.data.division==='QUALITY_FOODS'?'qf.manager':'lgb.manager',name:'Rehearsal manager',role:'MANAGER',divisionId:division.id,passwordHash:await hashPassword('correct-horse-battery'),mustChangePassword:false}})
  }
  assert.equal(await prisma.stockMovement.count(),421)
  assert.equal(await prisma.auditLog.count({where:{action:'stock.opening_imported'}}),2)
  assert.equal(await prisma.stockReceipt.count(),0); assert.equal(await prisma.sale.count(),0); assert.equal(await prisma.payment.count(),0)
  const preview = await runOpeningImport(inputs)
  const batchFingerprint = createHash('sha256').update(JSON.stringify(preview.map(p=>({division:p.division,fingerprint:p.fingerprint})))).digest('hex')
  const report = {identity,migrations:await prisma.$queryRaw`SELECT migration_name,finished_at IS NOT NULL AS applied FROM _prisma_migrations ORDER BY migration_name`,
    rollbackPassed:true,replayPassed:true,concurrentReplayPassed:true,duplicateSourceRejected:true,reconciledRows:421,ledgerMismatches:0,
    companyDevelopmentImportAuthorized:false,preview,batchFingerprint,reconciliation}
  writeFileSync(resolve(dirname(paths[0]!),'rehearsal-results.json'),JSON.stringify(report,null,2)+'\n')
  writeFileSync(resolve(dirname(paths[0]!),'approval-manifest.json'),JSON.stringify({authorization:'PENDING',batchFingerprint,plans:preview},null,2)+'\n')
  console.log(JSON.stringify(report,null,2))
}
main().catch(() => { console.error('Opening-stock rehearsal failed; inspect test-only validation without logging credentials. No development inventory was accessed.'); process.exitCode=1 }).finally(()=>prisma.$disconnect())
