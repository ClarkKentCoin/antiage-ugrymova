

## Add Search Bar to Payments Tab

Add a search input (matching the Subscribers tab pattern) to `src/pages/admin/AdminPayments.tsx`:

1. Import `Search` from lucide-react and `Input` component
2. Add `search` state variable
3. Add search filtering to `filteredPayments` memo — match against `subscribers.telegram_username`, `subscribers.first_name`, `subscribers.last_name`, `subscribers.email`
4. Render the search input between the method filter buttons and the table, using the same markup as AdminSubscribers:
```tsx
<div className="relative w-full sm:max-w-sm">
  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  <Input placeholder="Search payments..." value={search} onChange={...} className="pl-9" />
</div>
```

Single file change: `src/pages/admin/AdminPayments.tsx`

