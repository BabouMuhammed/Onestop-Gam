/** Read-only reconciliation of the explicitly approved development import. */
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {readFileSync,writeFileSync} from 'node:fs'
import {resolve,join} from 'node:path'
import {fileURLToPath} from 'node:url'
import {prisma,Decimal} from '../src/db'
import {env} from '../src/env'
import {assertOpeningTarget} from './opening-stock-target'
import {prepareOpeningPlan,openingProductKey,runOpeningImport} from './opening-stock-plan'

const root=fileURLToPath(new URL('../../../',import.meta.url))
const directory=resolve(root,'data/import-review/2026-11-15/final-source-import')
const hash=(data:string|Buffer)=>createHash('sha256').update(data).digest('hex')
async function main(){
 const execution=JSON.parse(readFileSync(join(directory,'approved-execution.json'),'utf8'))
 assert.equal(execution.stage,'IMPORTED_AND_REPLAY_VERIFIED')
 const before=JSON.parse(readFileSync(join(execution.execution,'preflight-and-backup.json'),'utf8'))
 const inputs=['quality-foods.json','legayebi.json'].map(f=>JSON.parse(readFileSync(join(directory,f),'utf8')))
 const preview=await runOpeningImport(inputs)
 assert.equal(hash(JSON.stringify(preview.map(p=>({division:p.division,fingerprint:p.fingerprint})))),'103ab8a13b639f6311b01abe37830fab2ecfa940bcc22f009f511e369b7bd54e')
 assert.equal(hash(readFileSync(before.backup.file)),before.backup.sha256)
 const results=await prisma.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`
  const [identity]=await tx.$queryRaw<{database:string;role:string;host:string;port:number;schema:string}[]>`SELECT current_database() AS database,current_user AS role,host(inet_server_addr()) AS host,inet_server_port() AS port,current_schema() AS schema`
  assertOpeningTarget(env.NODE_ENV,identity)
  assert.deepEqual(identity,before.identity)
  const credentials=await tx.$queryRaw`SELECT id,"passwordHash","mustChangePassword" FROM "User" ORDER BY id`
  assert.equal(hash(JSON.stringify(credentials)),before.credentialFingerprint,'Administrator credential fields changed')
  assert.equal(await tx.user.count(),before.before.User.rows)
  const reconciliation=[]
  const attention=[]
  for(const input of inputs){
   const plan=prepareOpeningPlan(input)
   const division=await tx.division.findUniqueOrThrow({where:{code:plan.data.division}})
   const original=before.divisions.find((d:{code:string})=>d.code===division.code)
   assert.equal(division.id,original.id);assert.equal(division.name,original.name);assert.equal(division.skuPrefix,original.skuPrefix)
   assert.equal(division.nextSkuNumber,original.nextSkuNumber+plan.products)
   assert.equal(division.nextReceiptNumber,original.nextReceiptNumber);assert.equal(division.nextSaleNumber,original.nextSaleNumber)
   const products=await tx.product.findMany({where:{divisionId:division.id},include:{levels:{include:{location:true}},movements:true}})
   const locations=await tx.location.findMany({where:{divisionId:division.id}})
   assert.equal(products.length,plan.products);assert.equal(locations.length,plan.locations)
   assert.deepEqual(locations.map(l=>l.name).sort(),[...new Set(plan.data.items.map(i=>i.location))].sort())
   for(const [index,item]of plan.data.items.entries()){
    const product=products.find(p=>p.openingSourceKey===openingProductKey(plan.data,item))
    assert(product,'Missing original source entry')
    assert.equal(product.name,item.name);assert.equal(product.unit,item.unit);assert.equal(product.requiresStockReview,item.requiresStockReview)
    assert.equal(product.sellingPrice,null);assert.equal(product.costPrice,null);assert.equal(product.packSize,null)
    assert.equal(product.tracksExpiry,false);assert.equal(product.notes,item.remark)
    const raw=product.openingSource as Record<string,unknown>
    for(const [key,value]of Object.entries(item.raw!))assert.deepEqual(raw[key],value)
    assert.equal(raw.file,plan.data.source);assert.equal(raw.sha256,plan.data.sourceSha256);assert.equal(raw.countedOn,plan.data.countedOn)
    assert.equal(raw.rowFingerprint,plan.rowFingerprints[index])
    assert.equal(product.levels.length,1);assert.equal(product.movements.length,1)
    const level=product.levels[0]!,movement=product.movements[0]!
    assert.equal(level.location.name,item.location);assert.equal(level.location.divisionId,division.id);assert.equal(level.location.type,'OTHER')
    assert(new Decimal(item.quantity).equals(level.quantity))
    assert(movement.quantityDelta.equals(level.quantity));assert(movement.balanceAfter.equals(level.quantity))
    assert.equal(movement.divisionId,division.id);assert.equal(movement.locationId,level.locationId);assert.equal(movement.type,'OPENING')
    assert.equal(movement.createdAt.toISOString(),plan.data.countedOn+'T12:00:00.000Z')
    assert(movement.note?.includes(plan.data.source)&&movement.note.includes(item.raw!.sheet+'!'+item.raw!.cell))
    assert.equal(movement.userId,null)
    attention.push({division:division.code,sku:product.sku,productId:product.id,name:product.name,location:level.location.name,quantity:level.quantity.toString(),unit:product.unit,
     needsUnitConfirmation:product.unit==='UNSPECIFIED',requiresStockReview:product.requiresStockReview,needsSellingPrice:true,needsHistoricalReconciliation:true,
     sourceFile:raw.file,sourceSheet:raw.sheet,nameCell:raw.cell,quantityCell:raw.quantityCell,originalQuantity:raw.quantityText,originalUnit:raw.unitText,issues:raw.issues,notes:raw.notes})
   }
   const audits=await tx.auditLog.findMany({where:{divisionId:division.id,action:'stock.opening_imported'}})
   assert.equal(audits.length,1)
   const audit=audits[0]!.after as Record<string,unknown>
   assert.equal(audit.fingerprint,plan.fingerprint);assert.deepEqual(audit.rowFingerprints,plan.rowFingerprints)
   assert.equal((audit.approval as {approvedBy:string}).approvedBy,before.approvedBy)
   assert.equal(hash(readFileSync(join('C:/Users/m/Downloads/40811eyack.com.MAIL_xsbsxxypt8dh6!App',plan.data.source))),plan.data.sourceSha256)
   reconciliation.push({business:division.name,division:division.code,products:products.length,stockBalances:products.length,ledgerEntries:products.reduce((n,p)=>n+p.movements.length,0),locations:locations.length,
    unspecifiedUnits:products.filter(p=>p.unit==='UNSPECIFIED').length,reviewRequired:products.filter(p=>p.requiresStockReview).length,
    explicitUnits:products.filter(p=>p.unit!=='UNSPECIFIED').length,countDate:plan.data.countedOn,skuCounterAdvancedBy:plan.products,allOriginalRowsMatched:true})
  }
  assert.equal(await tx.product.count(),421);assert.equal(await tx.stockLevel.count(),421);assert.equal(await tx.stockMovement.count(),421);assert.equal(await tx.location.count(),14)
  for(const table of ['Supplier','StockReceipt','StockReceiptLine','StockReceiptReversal','Customer','Sale','SaleLine','SaleVoid','Payment','PriceChange']){
   const [snapshot]=await tx.$queryRawUnsafe<{data:unknown[]}[]>(`SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY id),'[]'::jsonb) AS data FROM public."${table}" t`)
   assert(snapshot)
   assert.equal(hash(JSON.stringify(snapshot.data)),before.before[table].digest,'An unrelated transaction table changed')
  }
  const [links]=await tx.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM "StockMovement" m JOIN "Product" p ON p.id=m."productId" JOIN "Location" l ON l.id=m."locationId" WHERE m."divisionId"<>p."divisionId" OR m."divisionId"<>l."divisionId"`
  assert.equal(links!.n,0)
  const [migration]=await tx.$queryRaw<{n:number}[]>`SELECT count(*)::int AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`
  assert.equal(migration!.n,7)
  return{identity,batchFingerprint:before.batchFingerprint,verification:'PASSED',reconciliation,totalSourceRows:421,totalBalances:421,totalLedgerEntries:421,totalLocations:14,
   ledgerMismatches:0,crossDivisionLinks:0,credentialFieldsUnchanged:true,existingDivisionIdentifiersPreserved:true,originalWorkbookHashesUnchanged:true,unrelatedTransactionsUnchanged:true,migrationsApplied:7,attention}
 },{timeout:60000})
 writeFileSync(join(execution.execution,'database-verification.json'),JSON.stringify(results,null,2)+'\n')
 const {attention,...summary}=results
 writeFileSync(join(execution.execution,'attention-register.json'),JSON.stringify(attention,null,2)+'\n')
 console.log(JSON.stringify(summary,null,2))
}
main().catch(()=>{console.error('Approved opening-stock reconciliation failed. Do not change balances automatically; investigate the read-only checks. Credentials are not logged.');process.exitCode=1}).finally(()=>prisma.$disconnect())
