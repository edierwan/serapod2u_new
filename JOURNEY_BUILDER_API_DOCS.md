# Journey Builder API Documentation

## Overview

Complete API routes for managing Journey Configurations in the Consumer Engagement system.

---

## 📚 API Endpoints

### 1. List Journeys

**GET** `/api/journey/list`

Get all journey configurations for the authenticated user's organization.

**Authentication**: Required (Supabase session)

**Response**:
```json
{
  "success": true,
  "journeys": [
    {
      "id": "uuid",
      "org_id": "uuid",
      "name": "Default Journey",
      "is_active": true,
      "is_default": true,
      "points_enabled": true,
      "lucky_draw_enabled": true,
      "redemption_enabled": false,
      "require_staff_otp_for_points": false,
      "require_customer_otp_for_lucky_draw": true,
      "require_customer_otp_for_redemption": false,
      "start_at": "2025-01-01T00:00:00Z",
      "end_at": "2025-12-31T23:59:59Z",
      "created_at": "2025-10-19T00:00:00Z",
      "updated_at": "2025-10-19T00:00:00Z"
    }
  ]
}
```

---

### 2. Get Effective Journey

**GET** `/api/journey/effective?orderId=xxx`

Get the effective journey configuration for a specific order. Uses fallback logic:
1. Journey linked to order (via `journey_order_links`)
2. Default journey for org
3. Any active journey for org

**Authentication**: Required

**Query Parameters**:
- `orderId` (required): UUID of the order

**Response**:
```json
{
  "success": true,
  "journey": {
    "id": "uuid",
    "org_id": "uuid",
    "name": "Premium Product Journey",
    ...
  }
}
```

**Error Response** (404):
```json
{
  "error": "No active journey found for this order"
}
```

---

### 3. Create Journey

**POST** `/api/journey/create`

Create a new journey configuration.

**Authentication**: Required (HQ Admin only, role_level ≤ 30)

**Request Body**:
```json
{
  "name": "Premium Product Journey",
  "is_default": false,
  "points_enabled": true,
  "lucky_draw_enabled": true,
  "redemption_enabled": false,
  "require_staff_otp_for_points": false,
  "require_customer_otp_for_lucky_draw": true,
  "require_customer_otp_for_redemption": false,
  "start_at": "2025-01-01T00:00:00Z",
  "end_at": "2025-12-31T23:59:59Z"
}
```

**Response**:
```json
{
  "success": true,
  "journey": {
    "id": "uuid",
    "org_id": "uuid",
    "name": "Premium Product Journey",
    ...
  }
}
```

**Business Logic**:
- If `is_default` is true, unsets any existing default journey for the org
- Validates time window (end_at must be after start_at)
- Journey is created as active by default

---

### 4. Update Journey

**PATCH** `/api/journey/update`

Update an existing journey configuration.

**Authentication**: Required (HQ Admin only)

**Request Body**:
```json
{
  "id": "uuid",
  "name": "Updated Journey Name",
  "is_active": false,
  "points_enabled": false,
  ...
}
```

**Response**:
```json
{
  "success": true,
  "journey": {
    "id": "uuid",
    ...
  }
}
```

**Business Logic**:
- Only allows updating journeys owned by user's org
- If setting `is_default: true`, unsets other defaults
- Validates time window if updated
- Only updates fields that are provided

**Allowed Fields**:
- `name`
- `is_active`
- `is_default`
- `points_enabled`
- `lucky_draw_enabled`
- `redemption_enabled`
- `require_staff_otp_for_points`
- `require_customer_otp_for_lucky_draw`
- `require_customer_otp_for_redemption`
- `start_at`
- `end_at`

---

### 5. Delete Journey

**DELETE** `/api/journey/delete?id=xxx`

Delete a journey configuration.

**Authentication**: Required (HQ Admin only)

**Query Parameters**:
- `id` (required): UUID of the journey to delete

**Response**:
```json
{
  "success": true,
  "message": "Journey deleted successfully"
}
```

**Business Logic**:
- Prevents deletion if journey is linked to any orders
- Returns error with message to set as inactive instead
- Only allows deleting journeys owned by user's org

**Error Response** (400):
```json
{
  "error": "Cannot delete journey that is linked to orders. Set it as inactive instead."
}
```

---

### 6. Duplicate Journey

**POST** `/api/journey/duplicate`

Create a copy of an existing journey.

**Authentication**: Required (HQ Admin only)

**Request Body**:
```json
{
  "id": "uuid"
}
```

**Response**:
```json
{
  "success": true,
  "journey": {
    "id": "new-uuid",
    "name": "Original Journey (Copy)",
    "is_active": false,
    "is_default": false,
    ...
  }
}
```

**Business Logic**:
- Copies all settings from source journey
- Appends " (Copy)" to the name
- Sets `is_active: false` (must be activated manually)
- Sets `is_default: false` (never duplicates as default)
- Only allows duplicating journeys owned by user's org

---

## 🔒 Access Control

All journey API routes enforce access control:

| Endpoint | Required Org Type | Required Role Level |
|----------|------------------|---------------------|
| List | Any (filters by user's org) | Any |
| Get Effective | Any | Any |
| Create | HQ | ≤ 30 (Admin+) |
| Update | HQ | ≤ 30 (Admin+) |
| Delete | HQ | ≤ 30 (Admin+) |
| Duplicate | HQ | ≤ 30 (Admin+) |

**Error Response** (403):
```json
{
  "error": "Insufficient permissions"
}
```

---

## 🧪 Usage Examples

### Frontend - Fetch Journeys
```typescript
const fetchJourneys = async () => {
  const response = await fetch('/api/journey/list')
  const data = await response.json()
  
  if (data.success) {
    setJourneys(data.journeys)
  }
}
```

### Frontend - Create Journey
```typescript
const createJourney = async (formData) => {
  const response = await fetch('/api/journey/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(formData)
  })
  
  const data = await response.json()
  if (data.success) {
    console.log('Journey created:', data.journey.id)
  }
}
```

### Frontend - Update Journey
```typescript
const updateJourney = async (id, updates) => {
  const response = await fetch('/api/journey/update', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, ...updates })
  })
  
  const data = await response.json()
  if (data.success) {
    console.log('Journey updated')
  }
}
```

### Frontend - Delete Journey
```typescript
const deleteJourney = async (id) => {
  const response = await fetch(`/api/journey/delete?id=${id}`, {
    method: 'DELETE'
  })
  
  const data = await response.json()
  if (!data.success) {
    alert(data.error) // Show error if linked to orders
  }
}
```

### Frontend - Duplicate Journey
```typescript
const duplicateJourney = async (id) => {
  const response = await fetch('/api/journey/duplicate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id })
  })
  
  const data = await response.json()
  if (data.success) {
    console.log('Duplicated as:', data.journey.name)
  }
}
```

### Backend - Get Journey for Order (Server-side)
```typescript
import { getEffectiveJourney } from '@/lib/journey'

// In API route or server component
const journey = await getEffectiveJourney(orderId)

if (journey && journey.points_enabled) {
  // Award points logic
}
```

---

## 🛠️ Utility Functions

### lib/journey.ts

#### `getEffectiveJourney(orderId: string)`

Get the effective journey for an order with fallback logic.

```typescript
import { getEffectiveJourney } from '@/lib/journey'

const journey = await getEffectiveJourney('order-uuid')
```

**Returns**: `JourneyConfig | null`

**Fallback Logic**:
1. Order-specific journey (via `journey_order_links`)
2. Default journey for org
3. Any active journey for org
4. Returns `null` if none found

**Time Window Check**: Automatically filters out journeys outside their time window.

---

#### `needOtp(flow, journeyConfig, orgId)`

Determine if OTP is required for a specific flow.

```typescript
import { needOtp } from '@/lib/journey'

const otpReq = await needOtp('points', journeyConfig, orgId)

if (otpReq.required) {
  // Request OTP via available channels
  console.log('Send OTP via:', otpReq.channels) // ['whatsapp', 'sms', 'email']
}
```

**Parameters**:
- `flow`: `'points' | 'lucky_draw' | 'redemption'`
- `journeyConfig`: Journey configuration object
- `orgId`: Organization UUID

**Returns**: `OtpRequirement`
```typescript
{
  required: boolean
  reason?: string
  channels: ('whatsapp' | 'sms' | 'email')[]
}
```

**Business Logic**:
- Checks journey-specific OTP flags
- For redemption: also checks `redemption_policies` table
- Returns available channels from `org_notification_settings`
- If no channels enabled, returns `required: false`

---

#### `isFeatureEnabled(journey, feature)`

Check if a feature is enabled in a journey.

```typescript
import { isFeatureEnabled } from '@/lib/journey'

if (isFeatureEnabled(journey, 'points')) {
  // Points system is enabled
}
```

**Parameters**:
- `journey`: Journey configuration object
- `feature`: `'points' | 'lucky_draw' | 'redemption'`

**Returns**: `boolean`

---

## 🔍 Error Types

### JourneyError Class

```typescript
import { JourneyError, JourneyErrorCodes } from '@/lib/journey'

throw new JourneyError(
  'OTP verification required',
  JourneyErrorCodes.OTP_REQUIRED,
  400
)
```

### Error Codes

| Code | Description |
|------|-------------|
| `OTP_REQUIRED` | OTP verification is required for this action |
| `OTP_INVALID` | Provided OTP is invalid |
| `OTP_EXPIRED` | OTP has expired |
| `POINTS_DISABLED` | Points system is disabled for this journey |
| `LUCKY_DRAW_DISABLED` | Lucky draw is disabled for this journey |
| `REDEMPTION_DISABLED` | Redemption is disabled for this journey |
| `JOURNEY_NOT_FOUND` | Journey configuration not found |
| `JOURNEY_INACTIVE` | Journey is not active |
| `JOURNEY_EXPIRED` | Journey is outside its time window |
| `ORDER_NOT_FOUND` | Order not found |
| `INVALID_TIME_WINDOW` | Time window validation failed |

---

## 📊 Database Tables

### `journey_configurations`

Primary table storing journey configs.

**Columns**:
- `id` (uuid, PK)
- `org_id` (uuid, FK → organizations)
- `name` (text)
- `is_active` (boolean)
- `is_default` (boolean)
- `points_enabled` (boolean)
- `lucky_draw_enabled` (boolean)
- `redemption_enabled` (boolean)
- `require_staff_otp_for_points` (boolean)
- `require_customer_otp_for_lucky_draw` (boolean)
- `require_customer_otp_for_redemption` (boolean)
- `start_at` (timestamptz, nullable)
- `end_at` (timestamptz, nullable)
- `created_at` (timestamptz)
- `updated_at` (timestamptz)

### `journey_order_links`

Links journeys to specific orders.

**Columns**:
- `id` (uuid, PK)
- `journey_config_id` (uuid, FK → journey_configurations)
- `order_id` (uuid, FK → orders)
- `created_at` (timestamptz)

---

## ✅ Testing Checklist

- [ ] List journeys returns correct data
- [ ] Get effective journey handles fallback logic
- [ ] Create journey sets default correctly
- [ ] Update journey validates permissions
- [ ] Delete journey prevents deletion when linked
- [ ] Duplicate journey appends " (Copy)" to name
- [ ] OTP requirements checked correctly
- [ ] Time window validation works
- [ ] Access control enforced (HQ only)
- [ ] Error messages are clear and helpful

---

**Status**: ✅ Complete and Ready for Use  
**Version**: 1.0  
**Last Updated**: 19 October 2025
