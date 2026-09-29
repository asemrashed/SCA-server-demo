import assert from 'node:assert/strict'
import test from 'node:test'
import {
  computeIsFullyPaid,
  isAdminWaiverPayment,
  paymentHistoryStatusLabel,
  remainingBalanceMinor,
} from './monthly-payment.utils.js'
import { MonthlyPaymentStatus } from '../../shared/enums.js'

test('isAdminWaiverPayment is true when fully paid flag is set below price', () => {
  assert.equal(isAdminWaiverPayment(50_000, 150_000, true), true)
})

test('isAdminWaiverPayment is false when amount meets price', () => {
  assert.equal(isAdminWaiverPayment(150_000, 150_000, true), false)
})

test('paymentHistoryStatusLabel returns admin waiver label', () => {
  assert.equal(
    paymentHistoryStatusLabel(50_000, 150_000, true, MonthlyPaymentStatus.APPROVED),
    'FULL_PAID_ADMIN_WAIVER',
  )
})

test('paymentHistoryStatusLabel returns full paid for paid-in-full amounts', () => {
  assert.equal(
    paymentHistoryStatusLabel(150_000, 150_000, true, MonthlyPaymentStatus.APPROVED),
    'FULL_PAID',
  )
})

test('computeIsFullyPaid is true when cumulative installments cover price', () => {
  assert.equal(computeIsFullyPaid(600_000, 500_000 + 100_000), true)
})

test('computeIsFullyPaid is false when cumulative is under price', () => {
  assert.equal(computeIsFullyPaid(600_000, 500_000), false)
})

test('computeIsFullyPaid respects markFullyPaid override', () => {
  assert.equal(computeIsFullyPaid(600_000, 100_000, true), true)
  assert.equal(computeIsFullyPaid(600_000, 100_000, false), false)
})

test('remainingBalanceMinor blocks overpay after full installments', () => {
  assert.equal(remainingBalanceMinor(600_000, 600_000), 0)
  assert.equal(remainingBalanceMinor(600_000, 500_000), 100_000)
})
