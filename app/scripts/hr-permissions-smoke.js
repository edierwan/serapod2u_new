import assert from 'node:assert/strict'

const baseUrl = process.env.BASE_URL || 'http://localhost:3000'

const run = async () => {
    const positionsRes = await fetch(`${baseUrl}/api/hr/positions`)
    assert.equal(positionsRes.status, 401, 'Expected 401 for unauthenticated HR positions request')

    const userRes = await fetch(`${baseUrl}/api/users/00000000-0000-0000-0000-000000000000/hr`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ department_id: null })
    })
    assert.equal(userRes.status, 401, 'Expected 401 for unauthenticated HR user update')

    console.log('HR permissions smoke tests passed.')
}

run().catch((error) => {
    console.error('HR permissions smoke tests failed:', error)
    process.exit(1)
})
