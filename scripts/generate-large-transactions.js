import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const outputPath = join(rootDir, 'data', 'transactions.large.json');

const categories = [
  'GROCERIES',
  'UTILITIES',
  'TRANSPORT',
  'ENTERTAINMENT',
  'DINING',
  'RENT',
  'SALARY',
  'INSURANCE',
];

const merchants = [
  'Edeka',
  'Lidl',
  'BVG',
  'Netflix',
  'Spotify',
  'Landlord AG',
  'ACME Payroll',
  'Allianz',
];

const accounts = ['Checking', 'Main Checking'];
const startDate = new Date('2025-09-01T00:00:00Z');
const totalTransactions = 12000;

function toDateString(date) {
  return date.toISOString().slice(0, 10);
}

function createAmount(index) {
  if (index % 15 === 0) {
    return 2400 + (index % 5) * 35;
  }

  if (index % 21 === 0) {
    return -950 - (index % 4) * 10;
  }

  return -1 * (12 + (index % 180) + ((index % 7) * 0.37));
}

function createCategory(index) {
  if (index % 15 === 0) return 'SALARY';
  if (index % 21 === 0) return 'RENT';
  return categories[index % categories.length];
}

function createMerchant(index, category) {
  if (category === 'SALARY') return 'ACME Payroll';
  if (category === 'RENT') return 'Landlord AG';
  return merchants[index % merchants.length];
}

function buildTransactions() {
  const transactions = [];
  let balance = 1200;

  for (let index = 0; index < totalTransactions; index += 1) {
    const date = new Date(startDate);
    date.setUTCDate(startDate.getUTCDate() + (index % 181));

    const category = createCategory(index);
    const amount = Number(createAmount(index).toFixed(2));
    balance = Number((balance + amount).toFixed(2));

    transactions.push({
      user_id: 'user_123',
      id: `txn_large_${index + 1}`,
      date: toDateString(date),
      amount,
      merchant: createMerchant(index, category),
      category,
      account: accounts[index % accounts.length],
      balance,
    });
  }

  for (let index = transactions.length - 1; index > 0; index -= 3) {
    const swapIndex = Math.max(0, index - 2);
    const current = transactions[index];
    transactions[index] = transactions[swapIndex];
    transactions[swapIndex] = current;
  }

  return transactions;
}

const transactions = buildTransactions();
writeFileSync(outputPath, `${JSON.stringify(transactions, null, 2)}\n`);

console.log(`Generated ${transactions.length} large transactions at ${outputPath}`);
