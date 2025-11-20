# Warehouse Ship: Cancel Shipment Feature

## Overview
Added a "Cancel Shipment" button that allows warehouse users to reset all scanned items back to their previous state before confirmation. This is useful when:
- Items were scanned incorrectly
- Wrong distributor was selected
- Need to restart the shipment preparation
- User changes their mind before confirming

## Implementation

### Frontend Changes (`WarehouseShipV2.tsx`)

#### 1. New State Variable
```typescript
const [canceling, setCanceling] = useState(false)
```

#### 2. Cancel Handler Function
```typescript
const handleCancelShipment = async () => {
  // Validates session exists
  // Confirms with user
  // Calls cancel API
  // Clears all local state
  // Reloads session and history
}
```

#### 3. UI Updates
- Added "Cancel Shipment" button next to "Confirm Shipment" button
- Button styled with red outline theme (border-red-300, text-red-600)
- Shows spinning icon during cancellation
- Disabled during confirmation or when no items to cancel
- Imported `XCircle` icon from lucide-react

### Backend API (`/api/warehouse/cancel-shipment/route.ts`)

#### Endpoint Details
- **Method**: POST
- **Path**: `/api/warehouse/cancel-shipment`
- **Auth**: Requires user_id

#### Request Body
```json
{
  "session_id": "uuid",
  "user_id": "uuid"
}
```

#### Response
```json
{
  "success": true,
  "message": "Shipment cancelled. X master cases and Y unique codes reverted to warehouse.",
  "reverted": {
    "master_codes": 3,
    "unique_codes": 60
  }
}
```

#### Process Flow
1. **Validate Session**
   - Checks if session exists
   - Only allows canceling sessions with status `pending`
   - Returns error for approved/completed sessions

2. **Revert Master Codes**
   - Updates status: `warehouse_packed` → `received_warehouse`
   - Clears `shipped_to_distributor_id`
   - Reverts all child unique codes

3. **Revert Individual Unique Codes**
   - Updates status: `warehouse_packed` → `received_warehouse`
   - Updates `current_location_org_id` back to warehouse

4. **Log Movements**
   - Creates movement records with type `warehouse_cancel`
   - Logs both master and unique code reversals
   - Records who cancelled and when

5. **Delete Session**
   - Deletes the pending session from database
   - Since session was never approved, safe to remove completely
   - Keeps database clean without invalid status values

## Database Changes

### Status Flow
```
Before Cancel:
QR Codes: warehouse_packed
Session: pending (exists in database)

After Cancel:
QR Codes: received_warehouse
Session: deleted (removed from database)
```

### Movement Log
- **Type**: `warehouse_cancel`
- **From/To**: warehouse_org_id (same location)
- **Status**: `received_warehouse`
- **Notes**: "Shipment cancelled - reverted [code] to warehouse"

## User Experience

### Confirmation Dialog
- User clicks "Cancel Shipment"
- Shows confirmation: "Cancel this shipment and reset X items back to warehouse_packed status?"
- User must confirm to proceed

### After Cancellation
1. Scanned codes list is cleared
2. Manual quantity is reset to 0
3. Progress counters reset to 0
4. Session is marked as cancelled in database
5. New empty session is created for fresh start
6. Toast notification confirms success
7. History tables refresh to show cancellation

### Button States
- **Enabled**: When items are scanned and session is pending
- **Disabled**: When confirming, canceling, or no items scanned
- **Loading**: Shows spinning icon while processing

## Safety Features

1. **Confirmation Required**: User must confirm before cancellation
2. **Status Validation**: Only pending sessions can be cancelled
3. **Atomic Operation**: All or nothing - if any step fails, returns error
4. **Movement Logging**: Full audit trail of cancelled shipments
5. **Fresh Session**: Creates new session after cancellation for clean slate

## Testing Checklist

- [ ] Select a distributor
- [ ] Scan multiple items (master cases and unique codes)
- [ ] Verify "Cancel Shipment" button appears
- [ ] Click "Cancel Shipment" button
- [ ] Confirm the cancellation dialog
- [ ] Verify progress counters reset to 0
- [ ] Verify scanned codes list is empty
- [ ] Check database - QR codes should have status `received_warehouse`
- [ ] Check database - session should be deleted (not exist anymore)
- [ ] Navigate away and come back - should show empty session
- [ ] Scan new items - should work normally with fresh session
- [ ] Check movement logs - should show `warehouse_cancel` entries
- [ ] Test canceling with master codes only
- [ ] Test canceling with unique codes only
- [ ] Test canceling with both types
- [ ] Test canceling with manual stock (should reset manual qty)
- [ ] Verify cannot cancel an approved/completed session

## Error Handling

### Common Errors
1. **No Session**: "No active shipment session to cancel"
2. **Invalid Status**: "Cannot cancel shipment with status: [status]"
3. **Session Not Found**: "Shipment session not found"
4. **Database Error**: "Failed to revert master codes/unique codes"

### Rollback Strategy
- If any step fails, error is thrown and returned to frontend
- Database operations are separate updates (master codes, unique codes, session)
- If one fails, others may succeed - manual intervention may be needed
- Movement logs help track what was actually reverted

## Files Modified/Created

### Created
1. `/app/src/app/api/warehouse/cancel-shipment/route.ts` - API endpoint

### Modified
1. `/app/src/components/dashboard/views/qr-tracking/WarehouseShipV2.tsx`
   - Added `canceling` state
   - Added `handleCancelShipment` function
   - Added "Cancel Shipment" button UI
   - Imported `XCircle` icon

## Benefits

✅ **Quick Recovery**: Easily reset shipment without manual intervention
✅ **Audit Trail**: All cancellations logged in movement history
✅ **Clean State**: Creates fresh session for new attempt
✅ **Safe Operation**: Requires confirmation to prevent accidents
✅ **Complete Reversal**: Reverts all codes back to warehouse status
✅ **Clean Database**: Pending sessions are deleted (movement logs remain for audit)
