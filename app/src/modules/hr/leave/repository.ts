/**
 * HR Leave – Repository (Mock implementation)
 *
 * Interface + in-memory mock data. When Supabase tables are ready,
 * create a `supabaseLeaveRepository` that implements the same interface.
 *
 * DB changes required:
 * ─────────────────────
 *  • hr_leave_types          — leave type definitions + policy JSON
 *  • hr_leave_requests       — employee requests
 *  • hr_leave_approvals      — per-step approval log
 *  • hr_leave_balances       — computed balance ledger
 *  • hr_approval_chains      — approval chain templates
 *  • hr_approval_chain_steps — ordered steps per chain
 *  • hr_delegation_rules     — temporary delegation
 *  • hr_public_holidays      — calendar of public holidays
 */

import type {
    LeaveType,
    LeaveRequest,
    LeaveBalance,
    ApprovalChain,
    DelegationRule,
    PublicHoliday,
    LeaveRequestFilters,
    CreateLeaveTypeDTO,
    UpdateLeaveTypeDTO,
    CreateLeaveRequestDTO,
    CreateApprovalChainDTO,
    CreateDelegationRuleDTO,
    LeaveRequestStatus,
} from './types'

// ── Interface ───────────────────────────────────────────────────

export interface ILeaveRepository {
    // Leave Types
    getLeaveTypes(): Promise<LeaveType[]>
    getLeaveTypeById(id: string): Promise<LeaveType | null>
    createLeaveType(dto: CreateLeaveTypeDTO): Promise<LeaveType>
    updateLeaveType(id: string, dto: UpdateLeaveTypeDTO): Promise<LeaveType>
    deleteLeaveType(id: string): Promise<void>

    // Leave Requests
    getLeaveRequests(filters?: LeaveRequestFilters): Promise<LeaveRequest[]>
    getLeaveRequestById(id: string): Promise<LeaveRequest | null>
    createLeaveRequest(dto: CreateLeaveRequestDTO): Promise<LeaveRequest>
    updateLeaveRequestStatus(
        id: string,
        status: LeaveRequestStatus,
        comment?: string
    ): Promise<LeaveRequest>

    // Leave Balances
    getLeaveBalances(employeeId: string): Promise<LeaveBalance[]>

    // Approval Chains
    getApprovalChains(): Promise<ApprovalChain[]>
    getApprovalChainById(id: string): Promise<ApprovalChain | null>
    createApprovalChain(dto: CreateApprovalChainDTO): Promise<ApprovalChain>
    updateApprovalChain(id: string, updates: Partial<ApprovalChain>): Promise<ApprovalChain>
    deleteApprovalChain(id: string): Promise<void>

    // Delegation
    getDelegationRules(): Promise<DelegationRule[]>
    createDelegationRule(dto: CreateDelegationRuleDTO): Promise<DelegationRule>
    deleteDelegationRule(id: string): Promise<void>

    // Public Holidays
    getPublicHolidays(year?: number): Promise<PublicHoliday[]>
}

// ── Helpers ─────────────────────────────────────────────────────

let _id = 1000
function uid(): string {
    return `mock-${++_id}`
}
function now(): string {
    return new Date().toISOString()
}

// ── Mock Data: Leave Types ──────────────────────────────────────

const MOCK_LEAVE_TYPES: LeaveType[] = [
    {
        id: 'lt-annual',
        code: 'AL',
        name: 'Annual Leave',
        description: 'Paid annual leave per Employment Act 1955 §60E. Minimum 8 days for <2 yrs service.',
        color: '#3b82f6',
        status: 'active',
        isStatutory: true,
        gender: 'all',
        requiresAttachment: false,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: null,
        minNoticeDays: 3,
        entitlementTiers: [
            { id: 'et-1', minYearsOfService: 0, maxYearsOfService: 2, daysEntitled: 8 },
            { id: 'et-2', minYearsOfService: 2, maxYearsOfService: 5, daysEntitled: 12 },
            { id: 'et-3', minYearsOfService: 5, maxYearsOfService: null, daysEntitled: 16 },
        ],
        accrualFrequency: 'yearly',
        carryForward: { enabled: true, maxDays: 5, expiryMonths: 3 },
        proRata: { enabled: true, basedOn: 'join_date', roundingRule: 'round_up' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-medical',
        code: 'MC',
        name: 'Medical Leave',
        description: 'Paid sick leave per Employment Act 1955 §60F. Requires medical certificate.',
        color: '#ef4444',
        status: 'active',
        isStatutory: true,
        gender: 'all',
        requiresAttachment: true,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: null,
        minNoticeDays: 0,
        entitlementTiers: [
            { id: 'et-4', minYearsOfService: 0, maxYearsOfService: 2, daysEntitled: 14 },
            { id: 'et-5', minYearsOfService: 2, maxYearsOfService: 5, daysEntitled: 18 },
            { id: 'et-6', minYearsOfService: 5, maxYearsOfService: null, daysEntitled: 22 },
        ],
        accrualFrequency: 'yearly',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: true, basedOn: 'join_date', roundingRule: 'round_up' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-hospitalization',
        code: 'HL',
        name: 'Hospitalization Leave',
        description: 'Up to 60 days per year for hospitalisation (inclusive of MC). Employment Act §60F.',
        color: '#f97316',
        status: 'active',
        isStatutory: true,
        gender: 'all',
        requiresAttachment: true,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: null,
        minNoticeDays: 0,
        entitlementTiers: [
            { id: 'et-7', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 60 },
        ],
        accrualFrequency: 'none',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: false, basedOn: 'calendar_year', roundingRule: 'round_nearest' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-maternity',
        code: 'MAT',
        name: 'Maternity Leave',
        description: 'Minimum 98 consecutive days for first 5 surviving children. Employment Act §37.',
        color: '#ec4899',
        status: 'active',
        isStatutory: true,
        gender: 'female',
        requiresAttachment: true,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: 98,
        minNoticeDays: 30,
        entitlementTiers: [
            { id: 'et-8', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 98 },
        ],
        accrualFrequency: 'none',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: false, basedOn: 'calendar_year', roundingRule: 'round_nearest' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-paternity',
        code: 'PAT',
        name: 'Paternity Leave',
        description: '7 consecutive days for married male employees. Employment Act §60FA.',
        color: '#8b5cf6',
        status: 'active',
        isStatutory: true,
        gender: 'male',
        requiresAttachment: true,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: 7,
        minNoticeDays: 14,
        entitlementTiers: [
            { id: 'et-9', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 7 },
        ],
        accrualFrequency: 'none',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: false, basedOn: 'calendar_year', roundingRule: 'round_nearest' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-compassionate',
        code: 'CL',
        name: 'Compassionate Leave',
        description: 'Bereavement leave for immediate family members.',
        color: '#6b7280',
        status: 'active',
        isStatutory: false,
        gender: 'all',
        requiresAttachment: false,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: 3,
        minNoticeDays: 0,
        entitlementTiers: [
            { id: 'et-10', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 3 },
        ],
        accrualFrequency: 'none',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: false, basedOn: 'calendar_year', roundingRule: 'round_nearest' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-replacement',
        code: 'RL',
        name: 'Replacement Leave',
        description: 'Time-off in lieu for working on rest days or public holidays.',
        color: '#14b8a6',
        status: 'active',
        isStatutory: false,
        gender: 'all',
        requiresAttachment: false,
        requiresApproval: true,
        isPaidLeave: true,
        maxConsecutiveDays: null,
        minNoticeDays: 1,
        entitlementTiers: [
            { id: 'et-11', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 0 },
        ],
        accrualFrequency: 'none',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: false, basedOn: 'calendar_year', roundingRule: 'round_nearest' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
    {
        id: 'lt-unpaid',
        code: 'UL',
        name: 'Unpaid Leave',
        description: 'Leave without pay. Requires management approval.',
        color: '#a3a3a3',
        status: 'active',
        isStatutory: false,
        gender: 'all',
        requiresAttachment: false,
        requiresApproval: true,
        isPaidLeave: false,
        maxConsecutiveDays: 30,
        minNoticeDays: 7,
        entitlementTiers: [
            { id: 'et-12', minYearsOfService: 0, maxYearsOfService: null, daysEntitled: 30 },
        ],
        accrualFrequency: 'none',
        carryForward: { enabled: false, maxDays: 0, expiryMonths: 0 },
        proRata: { enabled: false, basedOn: 'calendar_year', roundingRule: 'round_nearest' },
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
    },
]

// ── Mock Data: Leave Requests ───────────────────────────────────

const MOCK_LEAVE_REQUESTS: LeaveRequest[] = [
    {
        id: 'lr-1',
        employeeId: 'emp-1',
        employeeName: 'Ahmad Razif',
        employeeAvatar: null,
        departmentId: 'dept-eng',
        departmentName: 'Engineering',
        leaveTypeId: 'lt-annual',
        leaveTypeName: 'Annual Leave',
        leaveTypeColor: '#3b82f6',
        startDate: '2025-02-10',
        endDate: '2025-02-14',
        totalDays: 5,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Family vacation to Langkawi',
        attachmentUrl: null,
        status: 'approved',
        approvals: [
            {
                id: 'ap-1',
                requestId: 'lr-1',
                approverId: 'mgr-1',
                approverName: 'Siti Aminah',
                approverRole: 'Engineering Manager',
                level: 1,
                action: 'approve',
                comment: 'Approved. Enjoy your trip!',
                actionedAt: '2025-02-03T09:15:00Z',
                dueAt: '2025-02-05T09:00:00Z',
            },
        ],
        createdAt: '2025-02-01T08:30:00Z',
        updatedAt: '2025-02-03T09:15:00Z',
    },
    {
        id: 'lr-2',
        employeeId: 'emp-2',
        employeeName: 'Nurul Huda',
        employeeAvatar: null,
        departmentId: 'dept-hr',
        departmentName: 'Human Resources',
        leaveTypeId: 'lt-medical',
        leaveTypeName: 'Medical Leave',
        leaveTypeColor: '#ef4444',
        startDate: '2025-01-27',
        endDate: '2025-01-28',
        totalDays: 2,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Fever and flu symptoms',
        attachmentUrl: '/mock/mc-cert-nurul.pdf',
        status: 'approved',
        approvals: [
            {
                id: 'ap-2',
                requestId: 'lr-2',
                approverId: 'mgr-2',
                approverName: 'Lim Wei Ling',
                approverRole: 'HR Manager',
                level: 1,
                action: 'approve',
                comment: 'Get well soon',
                actionedAt: '2025-01-27T10:00:00Z',
                dueAt: '2025-01-29T10:00:00Z',
            },
        ],
        createdAt: '2025-01-27T07:45:00Z',
        updatedAt: '2025-01-27T10:00:00Z',
    },
    {
        id: 'lr-3',
        employeeId: 'emp-3',
        employeeName: 'Lee Chong Wei',
        employeeAvatar: null,
        departmentId: 'dept-sales',
        departmentName: 'Sales',
        leaveTypeId: 'lt-annual',
        leaveTypeName: 'Annual Leave',
        leaveTypeColor: '#3b82f6',
        startDate: '2025-03-03',
        endDate: '2025-03-07',
        totalDays: 5,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Attending cousin wedding in Penang',
        attachmentUrl: null,
        status: 'pending',
        approvals: [
            {
                id: 'ap-3',
                requestId: 'lr-3',
                approverId: 'mgr-3',
                approverName: 'Tan Boon Keat',
                approverRole: 'Sales Director',
                level: 1,
                action: null,
                comment: null,
                actionedAt: null,
                dueAt: '2025-02-28T09:00:00Z',
            },
        ],
        createdAt: '2025-02-20T14:00:00Z',
        updatedAt: '2025-02-20T14:00:00Z',
    },
    {
        id: 'lr-4',
        employeeId: 'emp-4',
        employeeName: 'Priya Nair',
        employeeAvatar: null,
        departmentId: 'dept-eng',
        departmentName: 'Engineering',
        leaveTypeId: 'lt-annual',
        leaveTypeName: 'Annual Leave',
        leaveTypeColor: '#3b82f6',
        startDate: '2025-02-24',
        endDate: '2025-02-24',
        totalDays: 0.5,
        isHalfDay: true,
        halfDayPeriod: 'morning',
        reason: 'Personal errand — morning appointment',
        attachmentUrl: null,
        status: 'pending',
        approvals: [
            {
                id: 'ap-4',
                requestId: 'lr-4',
                approverId: 'mgr-1',
                approverName: 'Siti Aminah',
                approverRole: 'Engineering Manager',
                level: 1,
                action: null,
                comment: null,
                actionedAt: null,
                dueAt: '2025-02-22T09:00:00Z',
            },
        ],
        createdAt: '2025-02-19T16:30:00Z',
        updatedAt: '2025-02-19T16:30:00Z',
    },
    {
        id: 'lr-5',
        employeeId: 'emp-5',
        employeeName: 'Muhammad Faiz',
        employeeAvatar: null,
        departmentId: 'dept-ops',
        departmentName: 'Operations',
        leaveTypeId: 'lt-compassionate',
        leaveTypeName: 'Compassionate Leave',
        leaveTypeColor: '#6b7280',
        startDate: '2025-01-15',
        endDate: '2025-01-17',
        totalDays: 3,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Family bereavement',
        attachmentUrl: null,
        status: 'approved',
        approvals: [
            {
                id: 'ap-5',
                requestId: 'lr-5',
                approverId: 'mgr-4',
                approverName: 'Rajesh Kumar',
                approverRole: 'Operations Manager',
                level: 1,
                action: 'approve',
                comment: 'Our condolences. Approved immediately.',
                actionedAt: '2025-01-15T08:00:00Z',
                dueAt: '2025-01-17T08:00:00Z',
            },
        ],
        createdAt: '2025-01-15T07:30:00Z',
        updatedAt: '2025-01-15T08:00:00Z',
    },
    {
        id: 'lr-6',
        employeeId: 'emp-1',
        employeeName: 'Ahmad Razif',
        employeeAvatar: null,
        departmentId: 'dept-eng',
        departmentName: 'Engineering',
        leaveTypeId: 'lt-medical',
        leaveTypeName: 'Medical Leave',
        leaveTypeColor: '#ef4444',
        startDate: '2025-01-20',
        endDate: '2025-01-20',
        totalDays: 1,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Food poisoning',
        attachmentUrl: '/mock/mc-cert-ahmad.pdf',
        status: 'approved',
        approvals: [
            {
                id: 'ap-6',
                requestId: 'lr-6',
                approverId: 'mgr-1',
                approverName: 'Siti Aminah',
                approverRole: 'Engineering Manager',
                level: 1,
                action: 'approve',
                comment: null,
                actionedAt: '2025-01-20T10:30:00Z',
                dueAt: '2025-01-22T10:00:00Z',
            },
        ],
        createdAt: '2025-01-20T08:00:00Z',
        updatedAt: '2025-01-20T10:30:00Z',
    },
    {
        id: 'lr-7',
        employeeId: 'emp-6',
        employeeName: 'Wong Mei Fen',
        employeeAvatar: null,
        departmentId: 'dept-finance',
        departmentName: 'Finance',
        leaveTypeId: 'lt-annual',
        leaveTypeName: 'Annual Leave',
        leaveTypeColor: '#3b82f6',
        startDate: '2025-03-17',
        endDate: '2025-03-21',
        totalDays: 5,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Year-end school holiday trip with family',
        attachmentUrl: null,
        status: 'pending',
        approvals: [
            {
                id: 'ap-7a',
                requestId: 'lr-7',
                approverId: 'mgr-5',
                approverName: 'Chen Jia Hao',
                approverRole: 'Finance Manager',
                level: 1,
                action: 'approve',
                comment: 'OK from my side',
                actionedAt: '2025-02-26T11:00:00Z',
                dueAt: '2025-02-28T11:00:00Z',
            },
            {
                id: 'ap-7b',
                requestId: 'lr-7',
                approverId: 'mgr-2',
                approverName: 'Lim Wei Ling',
                approverRole: 'HR Manager',
                level: 2,
                action: null,
                comment: null,
                actionedAt: null,
                dueAt: '2025-03-03T11:00:00Z',
            },
        ],
        createdAt: '2025-02-24T09:00:00Z',
        updatedAt: '2025-02-26T11:00:00Z',
    },
    {
        id: 'lr-8',
        employeeId: 'emp-7',
        employeeName: 'Amirah binti Yusof',
        employeeAvatar: null,
        departmentId: 'dept-hr',
        departmentName: 'Human Resources',
        leaveTypeId: 'lt-maternity',
        leaveTypeName: 'Maternity Leave',
        leaveTypeColor: '#ec4899',
        startDate: '2025-04-01',
        endDate: '2025-07-07',
        totalDays: 98,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Maternity leave — expected delivery early April',
        attachmentUrl: '/mock/pregnancy-letter-amirah.pdf',
        status: 'approved',
        approvals: [
            {
                id: 'ap-8',
                requestId: 'lr-8',
                approverId: 'mgr-2',
                approverName: 'Lim Wei Ling',
                approverRole: 'HR Manager',
                level: 1,
                action: 'approve',
                comment: 'Congratulations! Approved as per policy.',
                actionedAt: '2025-02-15T09:00:00Z',
                dueAt: '2025-02-17T09:00:00Z',
            },
        ],
        createdAt: '2025-02-10T08:00:00Z',
        updatedAt: '2025-02-15T09:00:00Z',
    },
    {
        id: 'lr-9',
        employeeId: 'emp-3',
        employeeName: 'Lee Chong Wei',
        employeeAvatar: null,
        departmentId: 'dept-sales',
        departmentName: 'Sales',
        leaveTypeId: 'lt-unpaid',
        leaveTypeName: 'Unpaid Leave',
        leaveTypeColor: '#a3a3a3',
        startDate: '2025-01-06',
        endDate: '2025-01-10',
        totalDays: 5,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Extended personal leave — house renovation',
        attachmentUrl: null,
        status: 'rejected',
        approvals: [
            {
                id: 'ap-9',
                requestId: 'lr-9',
                approverId: 'mgr-3',
                approverName: 'Tan Boon Keat',
                approverRole: 'Sales Director',
                level: 1,
                action: 'reject',
                comment: 'Cannot approve during Q1 sales push. Please reschedule.',
                actionedAt: '2025-01-03T14:00:00Z',
                dueAt: '2025-01-05T14:00:00Z',
            },
        ],
        createdAt: '2025-01-02T10:00:00Z',
        updatedAt: '2025-01-03T14:00:00Z',
    },
    {
        id: 'lr-10',
        employeeId: 'emp-4',
        employeeName: 'Priya Nair',
        employeeAvatar: null,
        departmentId: 'dept-eng',
        departmentName: 'Engineering',
        leaveTypeId: 'lt-replacement',
        leaveTypeName: 'Replacement Leave',
        leaveTypeColor: '#14b8a6',
        startDate: '2025-02-17',
        endDate: '2025-02-17',
        totalDays: 1,
        isHalfDay: false,
        halfDayPeriod: null,
        reason: 'Worked on Saturday 15 Feb for deployment',
        attachmentUrl: null,
        status: 'approved',
        approvals: [
            {
                id: 'ap-10',
                requestId: 'lr-10',
                approverId: 'mgr-1',
                approverName: 'Siti Aminah',
                approverRole: 'Engineering Manager',
                level: 1,
                action: 'approve',
                comment: null,
                actionedAt: '2025-02-16T09:00:00Z',
                dueAt: '2025-02-18T09:00:00Z',
            },
        ],
        createdAt: '2025-02-15T18:00:00Z',
        updatedAt: '2025-02-16T09:00:00Z',
    },
]

// ── Mock Data: Leave Balances ───────────────────────────────────

const MOCK_BALANCES: Record<string, LeaveBalance[]> = {
    'emp-1': [
        { leaveTypeId: 'lt-annual', leaveTypeName: 'Annual Leave', leaveTypeColor: '#3b82f6', entitled: 12, taken: 5, pending: 0, remaining: 7, carriedForward: 2 },
        { leaveTypeId: 'lt-medical', leaveTypeName: 'Medical Leave', leaveTypeColor: '#ef4444', entitled: 18, taken: 1, pending: 0, remaining: 17, carriedForward: 0 },
        { leaveTypeId: 'lt-compassionate', leaveTypeName: 'Compassionate Leave', leaveTypeColor: '#6b7280', entitled: 3, taken: 0, pending: 0, remaining: 3, carriedForward: 0 },
        { leaveTypeId: 'lt-replacement', leaveTypeName: 'Replacement Leave', leaveTypeColor: '#14b8a6', entitled: 2, taken: 0, pending: 0, remaining: 2, carriedForward: 0 },
    ],
    default: [
        { leaveTypeId: 'lt-annual', leaveTypeName: 'Annual Leave', leaveTypeColor: '#3b82f6', entitled: 12, taken: 3, pending: 1, remaining: 8, carriedForward: 0 },
        { leaveTypeId: 'lt-medical', leaveTypeName: 'Medical Leave', leaveTypeColor: '#ef4444', entitled: 14, taken: 2, pending: 0, remaining: 12, carriedForward: 0 },
        { leaveTypeId: 'lt-compassionate', leaveTypeName: 'Compassionate Leave', leaveTypeColor: '#6b7280', entitled: 3, taken: 0, pending: 0, remaining: 3, carriedForward: 0 },
    ],
}

// ── Mock Data: Approval Chains ──────────────────────────────────

const MOCK_APPROVAL_CHAINS: ApprovalChain[] = [
    {
        id: 'ac-default',
        name: 'Standard Approval',
        description: 'Default flow: Direct Manager → HR for all standard leave types.',
        isDefault: true,
        leaveTypeIds: ['lt-annual', 'lt-medical', 'lt-compassionate', 'lt-replacement', 'lt-unpaid'],
        steps: [
            { id: 'acs-1', level: 1, role: 'direct_manager', customApproverId: null, customApproverName: null, autoApproveAfterHours: 48, canDelegate: true },
            { id: 'acs-2', level: 2, role: 'hr_manager', customApproverId: null, customApproverName: null, autoApproveAfterHours: null, canDelegate: true },
        ],
        escalationEnabled: true,
        escalationHours: 72,
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-15T00:00:00Z',
    },
    {
        id: 'ac-extended',
        name: 'Extended Leave Approval',
        description: 'For maternity, paternity and hospitalization: Manager → HR → CEO.',
        isDefault: false,
        leaveTypeIds: ['lt-maternity', 'lt-paternity', 'lt-hospitalization'],
        steps: [
            { id: 'acs-3', level: 1, role: 'direct_manager', customApproverId: null, customApproverName: null, autoApproveAfterHours: 24, canDelegate: true },
            { id: 'acs-4', level: 2, role: 'hr_manager', customApproverId: null, customApproverName: null, autoApproveAfterHours: 48, canDelegate: true },
            { id: 'acs-5', level: 3, role: 'ceo', customApproverId: null, customApproverName: null, autoApproveAfterHours: null, canDelegate: false },
        ],
        escalationEnabled: true,
        escalationHours: 48,
        organizationId: 'org-1',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-06-15T00:00:00Z',
    },
    {
        id: 'ac-department-head',
        name: 'Department Head Only',
        description: 'Single-step: Department Head approves directly.',
        isDefault: false,
        leaveTypeIds: [],
        steps: [
            { id: 'acs-6', level: 1, role: 'department_head', customApproverId: null, customApproverName: null, autoApproveAfterHours: null, canDelegate: true },
        ],
        escalationEnabled: false,
        escalationHours: 0,
        organizationId: 'org-1',
        createdAt: '2024-03-01T00:00:00Z',
        updatedAt: '2024-03-01T00:00:00Z',
    },
]

// ── Mock Data: Delegation Rules ─────────────────────────────────

const MOCK_DELEGATION_RULES: DelegationRule[] = [
    {
        id: 'del-1',
        delegatorId: 'mgr-1',
        delegatorName: 'Siti Aminah',
        delegateId: 'mgr-6',
        delegateName: 'Zulkifli Hassan',
        startDate: '2025-03-01',
        endDate: '2025-03-15',
        isActive: true,
        createdAt: '2025-02-25T10:00:00Z',
    },
    {
        id: 'del-2',
        delegatorId: 'mgr-3',
        delegatorName: 'Tan Boon Keat',
        delegateId: 'mgr-7',
        delegateName: 'Kavitha Subramaniam',
        startDate: '2025-02-10',
        endDate: '2025-02-14',
        isActive: false,
        createdAt: '2025-02-05T14:00:00Z',
    },
]

// ── Mock Data: Public Holidays (Malaysia 2025) ──────────────────

const MOCK_HOLIDAYS: PublicHoliday[] = [
    { id: 'ph-1', name: 'New Year\'s Day', date: '2025-01-01', isRecurring: true, state: null },
    { id: 'ph-2', name: 'Thaipusam', date: '2025-01-14', isRecurring: false, state: null },
    { id: 'ph-3', name: 'Israk & Mikraj', date: '2025-01-27', isRecurring: false, state: null },
    { id: 'ph-4', name: 'Federal Territory Day', date: '2025-02-01', isRecurring: true, state: 'KL' },
    { id: 'ph-5', name: 'Nuzul Al-Quran', date: '2025-02-27', isRecurring: false, state: null },
    { id: 'ph-6', name: 'Hari Raya Aidilfitri (Day 1)', date: '2025-03-30', isRecurring: false, state: null },
    { id: 'ph-7', name: 'Hari Raya Aidilfitri (Day 2)', date: '2025-03-31', isRecurring: false, state: null },
    { id: 'ph-8', name: 'Labour Day', date: '2025-05-01', isRecurring: true, state: null },
    { id: 'ph-9', name: 'Vesak Day', date: '2025-05-12', isRecurring: false, state: null },
    { id: 'ph-10', name: 'Yang di-Pertuan Agong Birthday', date: '2025-06-02', isRecurring: false, state: null },
    { id: 'ph-11', name: 'Hari Raya Haji', date: '2025-06-07', isRecurring: false, state: null },
    { id: 'ph-12', name: 'Awal Muharram', date: '2025-06-27', isRecurring: false, state: null },
    { id: 'ph-13', name: 'Malaysia Day', date: '2025-09-16', isRecurring: true, state: null },
    { id: 'ph-14', name: 'Mawlid Nabi', date: '2025-09-05', isRecurring: false, state: null },
    { id: 'ph-15', name: 'Deepavali', date: '2025-10-20', isRecurring: false, state: null },
    { id: 'ph-16', name: 'Christmas Day', date: '2025-12-25', isRecurring: true, state: null },
    { id: 'ph-17', name: 'National Day', date: '2025-08-31', isRecurring: true, state: null },
]

// ── Mock Repository Implementation ──────────────────────────────

class MockLeaveRepository implements ILeaveRepository {
    private leaveTypes = [...MOCK_LEAVE_TYPES]
    private leaveRequests = [...MOCK_LEAVE_REQUESTS]
    private approvalChains = [...MOCK_APPROVAL_CHAINS]
    private delegationRules = [...MOCK_DELEGATION_RULES]
    private holidays = [...MOCK_HOLIDAYS]

    // ── Simulate async ──
    private delay(ms = 150): Promise<void> {
        return new Promise((r) => setTimeout(r, ms))
    }

    // ── Leave Types ──────────────────────────────────────────────

    async getLeaveTypes(): Promise<LeaveType[]> {
        await this.delay()
        return [...this.leaveTypes]
    }

    async getLeaveTypeById(id: string): Promise<LeaveType | null> {
        await this.delay(80)
        return this.leaveTypes.find((t) => t.id === id) ?? null
    }

    async createLeaveType(dto: CreateLeaveTypeDTO): Promise<LeaveType> {
        await this.delay()
        const lt: LeaveType = { ...dto, id: uid(), createdAt: now(), updatedAt: now() }
        this.leaveTypes.push(lt)
        return lt
    }

    async updateLeaveType(id: string, dto: UpdateLeaveTypeDTO): Promise<LeaveType> {
        await this.delay()
        const idx = this.leaveTypes.findIndex((t) => t.id === id)
        if (idx === -1) throw new Error(`Leave type ${id} not found`)
        this.leaveTypes[idx] = { ...this.leaveTypes[idx], ...dto, updatedAt: now() }
        return this.leaveTypes[idx]
    }

    async deleteLeaveType(id: string): Promise<void> {
        await this.delay()
        this.leaveTypes = this.leaveTypes.filter((t) => t.id !== id)
    }

    // ── Leave Requests ───────────────────────────────────────────

    async getLeaveRequests(filters?: LeaveRequestFilters): Promise<LeaveRequest[]> {
        await this.delay()
        let result = [...this.leaveRequests]
        if (filters?.status && filters.status !== 'all') {
            result = result.filter((r) => r.status === filters.status)
        }
        if (filters?.leaveTypeId) {
            result = result.filter((r) => r.leaveTypeId === filters.leaveTypeId)
        }
        if (filters?.employeeId) {
            result = result.filter((r) => r.employeeId === filters.employeeId)
        }
        if (filters?.departmentId) {
            result = result.filter((r) => r.departmentId === filters.departmentId)
        }
        // Sort newest first
        return result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    }

    async getLeaveRequestById(id: string): Promise<LeaveRequest | null> {
        await this.delay(80)
        return this.leaveRequests.find((r) => r.id === id) ?? null
    }

    async createLeaveRequest(dto: CreateLeaveRequestDTO): Promise<LeaveRequest> {
        await this.delay()
        const lr: LeaveRequest = {
            ...dto,
            id: uid(),
            status: 'pending',
            approvals: [],
            createdAt: now(),
            updatedAt: now(),
        }
        this.leaveRequests.unshift(lr)
        return lr
    }

    async updateLeaveRequestStatus(
        id: string,
        status: LeaveRequestStatus,
        comment?: string,
    ): Promise<LeaveRequest> {
        await this.delay()
        const idx = this.leaveRequests.findIndex((r) => r.id === id)
        if (idx === -1) throw new Error(`Leave request ${id} not found`)
        this.leaveRequests[idx] = { ...this.leaveRequests[idx], status, updatedAt: now() }
        // Update approval
        const approvals = this.leaveRequests[idx].approvals
        const pendingStep = approvals.find((a) => a.action === null)
        if (pendingStep) {
            pendingStep.action = status === 'approved' ? 'approve' : 'reject'
            pendingStep.comment = comment ?? null
            pendingStep.actionedAt = now()
        }
        return this.leaveRequests[idx]
    }

    // ── Leave Balances ───────────────────────────────────────────

    async getLeaveBalances(employeeId: string): Promise<LeaveBalance[]> {
        await this.delay(80)
        return MOCK_BALANCES[employeeId] ?? MOCK_BALANCES['default'] ?? []
    }

    // ── Approval Chains ──────────────────────────────────────────

    async getApprovalChains(): Promise<ApprovalChain[]> {
        await this.delay()
        return [...this.approvalChains]
    }

    async getApprovalChainById(id: string): Promise<ApprovalChain | null> {
        await this.delay(80)
        return this.approvalChains.find((c) => c.id === id) ?? null
    }

    async createApprovalChain(dto: CreateApprovalChainDTO): Promise<ApprovalChain> {
        await this.delay()
        const ac: ApprovalChain = { ...dto, id: uid(), createdAt: now(), updatedAt: now() }
        this.approvalChains.push(ac)
        return ac
    }

    async updateApprovalChain(id: string, updates: Partial<ApprovalChain>): Promise<ApprovalChain> {
        await this.delay()
        const idx = this.approvalChains.findIndex((c) => c.id === id)
        if (idx === -1) throw new Error(`Approval chain ${id} not found`)
        this.approvalChains[idx] = { ...this.approvalChains[idx], ...updates, updatedAt: now() }
        return this.approvalChains[idx]
    }

    async deleteApprovalChain(id: string): Promise<void> {
        await this.delay()
        this.approvalChains = this.approvalChains.filter((c) => c.id !== id)
    }

    // ── Delegation ───────────────────────────────────────────────

    async getDelegationRules(): Promise<DelegationRule[]> {
        await this.delay()
        return [...this.delegationRules]
    }

    async createDelegationRule(dto: CreateDelegationRuleDTO): Promise<DelegationRule> {
        await this.delay()
        const dr: DelegationRule = { ...dto, id: uid(), createdAt: now() }
        this.delegationRules.push(dr)
        return dr
    }

    async deleteDelegationRule(id: string): Promise<void> {
        await this.delay()
        this.delegationRules = this.delegationRules.filter((d) => d.id !== id)
    }

    // ── Public Holidays ──────────────────────────────────────────

    async getPublicHolidays(year?: number): Promise<PublicHoliday[]> {
        await this.delay(80)
        if (!year) return [...this.holidays]
        return this.holidays.filter((h) => new Date(h.date).getFullYear() === year)
    }
}

// ── Singleton ───────────────────────────────────────────────────

let _instance: ILeaveRepository | null = null

export function getLeaveRepository(): ILeaveRepository {
    if (!_instance) _instance = new MockLeaveRepository()
    return _instance
}

/**
 * Factory that returns the Supabase-backed repository when organization_id
 * and user_id are available, or falls back to mock data.
 */
export function getLeaveRepositoryForOrg(
    organizationId: string | null,
    userId: string | null
): ILeaveRepository {
    if (organizationId && userId) {
        // Dynamic import avoided — use direct instantiation
        const { SupabaseLeaveRepository } = require('./supabaseRepository')
        return new SupabaseLeaveRepository(organizationId, userId)
    }
    return getLeaveRepository()
}
