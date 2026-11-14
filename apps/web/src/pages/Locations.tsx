import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router'
import { formatDate, LOCATION_TYPE_LABELS, LOCATION_TYPES, locationSchema, type LocationInput } from '@onestop/shared'
import { api } from '../api'
import { showFieldErrors } from '../forms'
import { useSession } from '../session'
import type { LocationRow } from '../types'
import { Button, DataTable, Dialog, EmptyState, ErrorAlert, Field, Flag, Input, PageHeader, Select, useNotify, type Column } from '../ui'

export function LocationsPage() {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [editing, setEditing] = useState<LocationRow | 'new' | null>(null)
  const [failure, setFailure] = useState<unknown>(null)
  const locations = useQuery({ queryKey: ['locations', division.id], queryFn: () => api<{ rows: LocationRow[] }>('/locations') })

  const setActive = useMutation({
    mutationFn: (l: LocationRow) => api(`/locations/${l.id}`, { method: 'PATCH', body: { isActive: !l.isActive } }),
    onMutate: () => setFailure(null),
    onSuccess: async (_data, l) => {
      await queryClient.invalidateQueries({ queryKey: ['locations', division.id] })
      notify(l.isActive ? `${l.name} deactivated` : `${l.name} reactivated`)
    },
    onError: setFailure,
  })

  const columns: Column<LocationRow>[] = [
    {
      key: 'name',
      header: 'Location',
      cell: (l) => (
        <Link to={`/inventory?location=${l.id}`} className="font-medium text-ink hover:text-brand hover:underline">
          {l.name}
        </Link>
      ),
    },
    { key: 'type', header: 'Type', hideBelow: 'sm', className: 'text-ink-2', cell: (l) => LOCATION_TYPE_LABELS[l.type] },
    { key: 'items', header: 'Items stored', numeric: true, cell: (l) => l.itemCount },
    {
      key: 'counted',
      header: 'Last counted',
      hideBelow: 'md',
      cell: (l) => (l.lastCountedAt ? formatDate(l.lastCountedAt) : <Flag tone="muted">Not yet counted here</Flag>),
    },
    { key: 'status', header: 'Status', hideBelow: 'sm', cell: (l) => (l.isActive ? 'Active' : <Flag tone="muted">Inactive</Flag>) },
    {
      key: 'actions',
      header: 'Actions',
      className: 'w-px whitespace-nowrap text-right',
      cell: (l) => (
        <span className="inline-flex gap-1">
          <Button variant="quiet" className="h-7 px-2" onClick={() => setEditing(l)}>
            Edit
          </Button>
          <Button variant="quiet" className="h-7 px-2" busy={setActive.isPending && setActive.variables?.id === l.id} onClick={() => setActive.mutate(l)}>
            {l.isActive ? 'Deactivate' : 'Reactivate'}
          </Button>
        </span>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Locations"
        detail={`Where ${division.name} keeps stock`}
        actions={
          <Button variant="primary" icon={<Plus className="size-4" aria-hidden />} onClick={() => setEditing('new')}>
            Add location
          </Button>
        }
      />
      <ErrorAlert error={locations.error ?? failure} className="mb-3" />
      <DataTable
        label="Locations"
        columns={columns}
        rows={locations.data?.rows}
        rowKey={(l) => l.id}
        loading={locations.isPending}
        empty={
          <EmptyState title="No locations yet" action={<Button variant="primary" onClick={() => setEditing('new')}>Add the first location</Button>}>
            A location is a shelf, a fridge, a table or a floor area where stock is kept.
          </EmptyState>
        }
      />
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={editing === 'new' ? 'Add location' : 'Edit location'}>
        <LocationForm location={editing === 'new' || editing === null ? undefined : editing} onClose={() => setEditing(null)} />
      </Dialog>
    </>
  )
}

function LocationForm({ location, onClose }: { location?: LocationRow; onClose: () => void }) {
  const { division } = useSession()
  const queryClient = useQueryClient()
  const notify = useNotify()
  const [failure, setFailure] = useState<unknown>(null)
  const form = useForm<LocationInput>({
    resolver: zodResolver(locationSchema),
    defaultValues: { name: location?.name ?? '', type: location?.type ?? 'SHELF' },
  })
  const save = useMutation({
    mutationFn: (input: LocationInput) =>
      location ? api(`/locations/${location.id}`, { method: 'PATCH', body: input }) : api('/locations', { method: 'POST', body: input }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['locations', division.id] })
      notify(location ? 'Location saved' : 'Location added')
      onClose()
    },
    onError: (error) => setFailure(showFieldErrors(error, form.setError, ['name', 'type']) ? null : error),
  })
  const { errors } = form.formState
  return (
    <form noValidate className="space-y-3" onSubmit={form.handleSubmit((v) => { setFailure(null); save.mutate(v) })}>
      <ErrorAlert error={failure} />
      <Field label="Name" hint="As staff say it, for example Shelf 2 or Blue table." error={errors.name?.message}>
        {(a) => <Input {...a} autoFocus {...form.register('name')} />}
      </Field>
      <Field label="Type" error={errors.type?.message}>
        {(a) => (
          <Select {...a} {...form.register('type')}>
            {LOCATION_TYPES.map((type) => (
              <option key={type} value={type}>
                {LOCATION_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <div className="-mx-4 -mb-4 flex justify-end gap-2 border-t border-line bg-sunken px-4 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" busy={save.isPending}>
          {location ? 'Save changes' : 'Add location'}
        </Button>
      </div>
    </form>
  )
}
