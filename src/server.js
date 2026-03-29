import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const currentFilePath = fileURLToPath(import.meta.url);
const __dirname = fileURLToPath(new URL('.', import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = join(rootDir, 'data');
const host = process.env.HOST ?? '127.0.0.1';
const port = Number.parseInt(process.env.PORT ?? '3004', 10);
const eventIntervalMs = Number.parseInt(process.env.TRANSACTION_EVENT_INTERVAL_MS ?? '4000', 10);
const heartbeatIntervalMs = Number.parseInt(process.env.SSE_HEARTBEAT_INTERVAL_MS ?? '15000', 10);

const transactionCategoryDefinitions = {
  SALARY: {
    merchants: ['ACME Payroll', 'Nordstern GmbH Payroll', 'Studio Nord Payroll'],
    accounts: ['Checking', 'Main Checking'],
    minAmount: 1800,
    maxAmount: 5200,
    sign: 1,
  },
  INCOME: {
    merchants: ['Freelance Payout', 'Consulting Invoice', 'Marketplace Settlement'],
    accounts: ['Checking', 'Main Checking', 'Business Checking'],
    minAmount: 650,
    maxAmount: 3200,
    sign: 1,
  },
  RENT: {
    merchants: ['Landlord AG', 'Wohnbau Berlin', 'City Apartments'],
    accounts: ['Checking', 'Main Checking'],
    minAmount: 900,
    maxAmount: 1500,
    sign: -1,
  },
  UTILITIES: {
    merchants: ['Vattenfall', 'Stadtwerke Berlin', 'Telekom'],
    accounts: ['Checking', 'Main Checking'],
    minAmount: 70,
    maxAmount: 260,
    sign: -1,
  },
  GROCERIES: {
    merchants: ['Edeka', 'Rewe', 'Aldi'],
    accounts: ['Checking', 'Main Checking', 'Credit Card'],
    minAmount: 20,
    maxAmount: 180,
    sign: -1,
  },
  HEALTH: {
    merchants: ['Apotheke Mitte', 'Dental Check', 'FitCare'],
    accounts: ['Checking', 'Main Checking', 'Credit Card'],
    minAmount: 20,
    maxAmount: 340,
    sign: -1,
  },
  ENTERTAINMENT: {
    merchants: ['Netflix', 'Spotify', 'Cinema Berlin'],
    accounts: ['Checking', 'Credit Card'],
    minAmount: 5,
    maxAmount: 75,
    sign: -1,
  },
  TRANSPORT: {
    merchants: ['BVG', 'DB Navigator', 'Uber'],
    accounts: ['Checking', 'Credit Card'],
    minAmount: 3,
    maxAmount: 95,
    sign: -1,
  },
  SHOPPING: {
    merchants: ['Decathlon', 'IKEA', 'MediaMarkt'],
    accounts: ['Checking', 'Credit Card'],
    minAmount: 25,
    maxAmount: 1200,
    sign: -1,
  },
  BANK_FEES: {
    merchants: ['Late Fee', 'Overdraft Fee', 'Card Replacement Fee'],
    accounts: ['Checking', 'Main Checking'],
    minAmount: 8,
    maxAmount: 40,
    sign: -1,
  },
};

const userEventProfiles = {
  user_123: ['SALARY', 'GROCERIES', 'UTILITIES', 'ENTERTAINMENT', 'TRANSPORT', 'HEALTH'],
  user_456: ['SALARY', 'RENT', 'GROCERIES', 'UTILITIES'],
  user_789: ['INCOME', 'RENT', 'GROCERIES', 'UTILITIES', 'BANK_FEES'],
  user_321: ['INCOME', 'RENT', 'GROCERIES', 'UTILITIES', 'BANK_FEES', 'HEALTH'],
  user_654: ['INCOME', 'RENT', 'SHOPPING', 'HEALTH', 'UTILITIES', 'GROCERIES'],
};

function loadJson(fileName) {
  const filePath = join(dataDir, fileName);
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body, null, 2));
}

function sendError(res, statusCode, message, details) {
  sendJson(res, statusCode, {
    error: message,
    ...(details ? { details } : {}),
  });
}

function sendSseHeaders(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
}

function writeSseEvent(res, { event, id, data }) {
  if (id !== undefined) {
    res.write(`id: ${id}\n`);
  }

  if (event) {
    res.write(`event: ${event}\n`);
  }

  const payload = typeof data === 'string' ? data : JSON.stringify(data);
  for (const line of payload.split('\n')) {
    res.write(`data: ${line}\n`);
  }

  res.write('\n');
}

function writeSseComment(res, comment) {
  res.write(`: ${comment}\n\n`);
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function stripUserId(record) {
  const { user_id: _userId, ...rest } = record;
  return rest;
}

function compareDateStrings(a, b) {
  return a.localeCompare(b);
}

function ensureUserExists(userId, users) {
  return users.some((user) => user.id === userId);
}

function parseRequest(req) {
  return new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
}

function validateUser(res, userId, users) {
  if (!ensureUserExists(userId, users)) {
    sendError(res, 404, `Unknown user '${userId}'`);
    return false;
  }

  return true;
}

function validateDateParam(res, name, value) {
  if (!value) {
    sendError(res, 400, `Missing required query parameter '${name}'`);
    return false;
  }

  if (!isIsoDate(value)) {
    sendError(res, 400, `Invalid date format for '${name}'`, 'Expected YYYY-MM-DD');
    return false;
  }

  return true;
}

function filterTransactions(transactions, userId, from, to) {
  return transactions
    .filter((transaction) => transaction.user_id === userId)
    .filter((transaction) => compareDateStrings(transaction.date, from) >= 0)
    .filter((transaction) => compareDateStrings(transaction.date, to) <= 0)
    .map(stripUserId);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function compareTransactions(a, b) {
  const dateDiff = compareDateStrings(a.date, b.date);
  if (dateDiff !== 0) {
    return dateDiff;
  }

  return a.id.localeCompare(b.id);
}

function sortTransactionsChronologically(transactions) {
  return [...transactions].sort(compareTransactions);
}

function toMonthKey(date) {
  return date.slice(0, 7);
}

function incrementMonth(monthKey) {
  const [year, month] = monthKey.split('-').map((value) => Number.parseInt(value, 10));
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}`;
}

function listMonthsBetween(startMonth, endMonth) {
  const months = [];
  let current = startMonth;

  while (compareDateStrings(current, endMonth) <= 0) {
    months.push(current);
    current = incrementMonth(current);
  }

  return months;
}

function createEmptyRawReliabilityMetrics(from) {
  return {
    income_regularity: 0,
    income_coverage_ratio: 0,
    essential_payments_consistency: 0,
    good_months: 0,
    negative_balance_days: 0,
    late_fee_events: 0,
    window_months: 1,
    from_month: toMonthKey(from),
    to_month: toMonthKey(from),
  };
}

function isIncomeTransaction(transaction) {
  return (
    transaction.amount > 0 &&
    ['SALARY', 'INCOME'].includes(transaction.category)
  );
}

function isEssentialExpense(transaction) {
  return (
    transaction.amount < 0 &&
    ['RENT', 'UTILITIES', 'GROCERIES', 'HEALTH'].includes(transaction.category)
  );
}

function isLateFeeTransaction(transaction) {
  const merchant = transaction.merchant.toLowerCase();
  return transaction.category === 'BANK_FEES' || merchant.includes('late fee');
}

function calculateRawReliabilityMetrics(transactions, from) {
  const relevantTransactions = sortTransactionsChronologically(
    transactions.filter((transaction) => compareDateStrings(transaction.date, from) >= 0),
  );

  if (relevantTransactions.length === 0) {
    return createEmptyRawReliabilityMetrics(from);
  }

  const monthSummaries = new Map();
  const negativeBalanceDates = new Set();
  let lateFeeEvents = 0;

  for (const transaction of relevantTransactions) {
    const monthKey = toMonthKey(transaction.date);
    const summary = monthSummaries.get(monthKey) ?? {
      income: 0,
      essentialExpenses: 0,
      net: 0,
      endingBalance: null,
      hasIncome: false,
      hasEssentialExpense: false,
    };

    summary.net = roundTo(summary.net + transaction.amount);
    summary.endingBalance = transaction.balance;

    if (isIncomeTransaction(transaction)) {
      summary.income = roundTo(summary.income + transaction.amount);
      summary.hasIncome = true;
    }

    if (isEssentialExpense(transaction)) {
      summary.essentialExpenses = roundTo(summary.essentialExpenses + Math.abs(transaction.amount));
      summary.hasEssentialExpense = true;
    }

    if (transaction.balance < 0) {
      negativeBalanceDates.add(transaction.date);
    }

    if (isLateFeeTransaction(transaction)) {
      lateFeeEvents += 1;
    }

    monthSummaries.set(monthKey, summary);
  }

  const months = listMonthsBetween(toMonthKey(from), toMonthKey(relevantTransactions.at(-1).date));
  const summarizedMonths = months.map((monthKey) => ({
    monthKey,
    ...(monthSummaries.get(monthKey) ?? {
      income: 0,
      essentialExpenses: 0,
      net: 0,
      endingBalance: null,
      hasIncome: false,
      hasEssentialExpense: false,
    }),
  }));

  const monthCount = summarizedMonths.length;
  const incomeMonths = summarizedMonths.filter((summary) => summary.hasIncome).length;
  const essentialMonths = summarizedMonths.filter((summary) => summary.hasEssentialExpense).length;
  const goodMonths = summarizedMonths.filter(
    (summary) => summary.net >= 0 && (summary.endingBalance ?? 0) >= 0,
  ).length;
  const totalIncome = summarizedMonths.reduce((sum, summary) => sum + summary.income, 0);
  const totalEssentialExpenses = summarizedMonths.reduce(
    (sum, summary) => sum + summary.essentialExpenses,
    0,
  );

  return {
    income_regularity: roundTo(incomeMonths / monthCount),
    income_coverage_ratio:
      totalEssentialExpenses === 0 ? roundTo(totalIncome > 0 ? 2 : 0) : roundTo(totalIncome / totalEssentialExpenses),
    essential_payments_consistency: roundTo(essentialMonths / monthCount),
    good_months: goodMonths,
    negative_balance_days: negativeBalanceDates.size,
    late_fee_events: lateFeeEvents,
    window_months: monthCount,
    from_month: months[0],
    to_month: months.at(-1),
  };
}

function createReliabilityDrivers(metrics) {
  const positiveSignals = [];
  const riskSignals = [];
  const incomeMonths = Math.round(metrics.income_regularity * metrics.window_months);

  if (incomeMonths > 0) {
    positiveSignals.push(`Income present in ${incomeMonths}/${metrics.window_months} months`);
  }

  if (metrics.essential_payments_consistency >= 0.8) {
    positiveSignals.push('Essential payments detected consistently');
  } else if (metrics.essential_payments_consistency >= 0.5) {
    positiveSignals.push('Essential payments appear in several months');
  }

  if (metrics.good_months > 0) {
    positiveSignals.push(`Good cashflow months: ${metrics.good_months}/${metrics.window_months}`);
  }

  if (metrics.negative_balance_days > 0) {
    riskSignals.push(`${metrics.negative_balance_days} negative balance day${metrics.negative_balance_days === 1 ? '' : 's'}`);
  }

  if (metrics.late_fee_events > 0) {
    riskSignals.push(`${metrics.late_fee_events} late fee event${metrics.late_fee_events === 1 ? '' : 's'}`);
  }

  if (metrics.income_coverage_ratio < 1) {
    riskSignals.push('Income does not fully cover essential expenses');
  }

  return [...positiveSignals.slice(0, 3), ...riskSignals.slice(0, 2)];
}

function createReliabilityResponse(baselineEntry, baselineRawMetrics, currentRawMetrics) {
  if (!currentRawMetrics) {
    return baselineEntry;
  }

  const adjustedMetrics = {
    income_regularity: clamp(
      roundTo(
        baselineEntry.metrics.income_regularity +
          (currentRawMetrics.income_regularity - baselineRawMetrics.income_regularity),
      ),
      0,
      1,
    ),
    income_coverage_ratio: clamp(
      roundTo(
        baselineEntry.metrics.income_coverage_ratio +
          (currentRawMetrics.income_coverage_ratio - baselineRawMetrics.income_coverage_ratio),
      ),
      0,
      5,
    ),
    essential_payments_consistency: clamp(
      roundTo(
        baselineEntry.metrics.essential_payments_consistency +
          (currentRawMetrics.essential_payments_consistency - baselineRawMetrics.essential_payments_consistency),
      ),
      0,
      1,
    ),
    good_months: Math.max(
      0,
      Math.min(
        Math.round(
          baselineEntry.metrics.good_months + (currentRawMetrics.good_months - baselineRawMetrics.good_months),
        ),
        Math.max(currentRawMetrics.window_months, baselineRawMetrics.window_months, 1),
      ),
    ),
    negative_balance_days: Math.max(
      0,
      Math.round(
        baselineEntry.metrics.negative_balance_days +
          (currentRawMetrics.negative_balance_days - baselineRawMetrics.negative_balance_days),
      ),
    ),
    late_fee_events: Math.max(
      0,
      Math.round(
        baselineEntry.metrics.late_fee_events +
          (currentRawMetrics.late_fee_events - baselineRawMetrics.late_fee_events),
      ),
    ),
    window_months: Math.max(currentRawMetrics.window_months, baselineRawMetrics.window_months, 1),
  };

  const positiveScore =
    adjustedMetrics.income_regularity * 30 +
    Math.min(adjustedMetrics.income_coverage_ratio / 2, 1) * 25 +
    adjustedMetrics.essential_payments_consistency * 20 +
    clamp(adjustedMetrics.good_months / adjustedMetrics.window_months, 0, 1) * 15;
  const penaltyScore =
    Math.min(adjustedMetrics.negative_balance_days * 2, 20) +
    Math.min(adjustedMetrics.late_fee_events * 6, 12);
  const reliabilityIndex = Math.round(clamp(positiveScore - penaltyScore + 10, 0, 100));

  return {
    user_id: baselineEntry.user_id,
    from: baselineEntry.from,
    currency: baselineEntry.currency,
    reliability_index: reliabilityIndex,
    score_band: reliabilityIndex >= 80 ? 'HIGH' : reliabilityIndex >= 50 ? 'MEDIUM' : 'LOW',
    metrics: {
      income_regularity: adjustedMetrics.income_regularity,
      income_coverage_ratio: adjustedMetrics.income_coverage_ratio,
      essential_payments_consistency: adjustedMetrics.essential_payments_consistency,
      good_months: adjustedMetrics.good_months,
      negative_balance_days: adjustedMetrics.negative_balance_days,
      late_fee_events: adjustedMetrics.late_fee_events,
    },
    drivers: createReliabilityDrivers(adjustedMetrics),
  };
}

function createInitialState() {
  const users = loadJson('users.json');
  const transactions = [...loadJson('transactions.json'), ...loadJson('transactions.large.json')];
  const reliabilityEntries = loadJson('reliability.json');
  const clientsByUser = new Map();
  const transactionsByUser = new Map(users.map((user) => [user.id, []]));
  const reliabilityByKey = new Map();

  let maxGeneratedId = 0;

  for (const transaction of transactions) {
    if (!transactionsByUser.has(transaction.user_id)) {
      transactionsByUser.set(transaction.user_id, []);
    }

    transactionsByUser.get(transaction.user_id).push({ ...transaction });

    const generatedIdMatch = transaction.id.match(/^txn_evt_(\d+)$/);
    if (generatedIdMatch) {
      maxGeneratedId = Math.max(maxGeneratedId, Number.parseInt(generatedIdMatch[1], 10));
    }
  }

  for (const reliabilityEntry of reliabilityEntries) {
    const userTransactions = transactionsByUser.get(reliabilityEntry.user_id) ?? [];
    reliabilityByKey.set(`${reliabilityEntry.user_id}:${reliabilityEntry.from}`, {
      baselineEntry: reliabilityEntry,
      baselineRawMetrics: calculateRawReliabilityMetrics(userTransactions, reliabilityEntry.from),
    });
  }

  return {
    users,
    clientsByUser,
    transactionsByUser,
    reliabilityByKey,
    nextEventId: 1,
    nextTransactionId: maxGeneratedId + 1,
    nextAddUserIndex: 0,
    eventTick: 0,
  };
}

function registerClient(state, userId, res) {
  const userClients = state.clientsByUser.get(userId) ?? new Set();
  userClients.add(res);
  state.clientsByUser.set(userId, userClients);

  const cleanup = () => {
    const currentClients = state.clientsByUser.get(userId);
    if (!currentClients) {
      return;
    }

    currentClients.delete(res);
    if (currentClients.size === 0) {
      state.clientsByUser.delete(userId);
    }
  };

  res.on('close', cleanup);
  res.on('error', cleanup);
}

function broadcastToUser(state, userId, payload) {
  const clients = state.clientsByUser.get(userId);
  if (!clients || clients.size === 0) {
    return;
  }

  const eventId = state.nextEventId++;
  for (const client of clients) {
    writeSseEvent(client, {
      event: 'transaction',
      id: eventId,
      data: payload,
    });
  }
}

function sendHeartbeat(state) {
  for (const clients of state.clientsByUser.values()) {
    for (const client of clients) {
      writeSseComment(client, 'keepalive');
    }
  }
}

function pickRandomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function getTodayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function findInsertionIndex(transactions, candidateTransaction) {
  const sortedTransactions = sortTransactionsChronologically(transactions);
  const nextTransaction = sortedTransactions.find(
    (transaction) => compareTransactions(candidateTransaction, transaction) < 0,
  );

  if (!nextTransaction) {
    return transactions.length;
  }

  return transactions.findIndex((transaction) => transaction.id === nextTransaction.id);
}

function adjustFollowingBalances(transactions, changedTransactionId, delta) {
  if (delta === 0) {
    return;
  }

  const sortedTransactions = sortTransactionsChronologically(transactions);
  let shouldAdjust = false;

  for (const transaction of sortedTransactions) {
    if (shouldAdjust) {
      transaction.balance = roundTo(transaction.balance + delta);
    }

    if (transaction.id === changedTransactionId) {
      shouldAdjust = true;
    }
  }
}

function createAddedTransactionDetails(userId, previousAccount) {
  const categories = userEventProfiles[userId] ?? Object.keys(transactionCategoryDefinitions);
  const category = pickRandomItem(categories);
  const definition = transactionCategoryDefinitions[category];
  const rawAmount =
    Math.random() * (definition.maxAmount - definition.minAmount) + definition.minAmount;
  const amount = roundTo(rawAmount * definition.sign);

  return {
    amount,
    merchant: pickRandomItem(definition.merchants),
    category,
    account: previousAccount ?? pickRandomItem(definition.accounts),
  };
}

function createAddedTransaction(state, userId, userTransactions) {
  const lastTransaction = sortTransactionsChronologically(userTransactions).at(-1);
  const previousBalance = lastTransaction?.balance ?? 1000;
  const details = createAddedTransactionDetails(userId, lastTransaction?.account);
  const transaction = {
    user_id: userId,
    id: `txn_evt_${state.nextTransactionId++}`,
    date: getTodayIsoDate(),
    amount: details.amount,
    merchant: details.merchant,
    category: details.category,
    account: details.account,
    balance: roundTo(previousBalance + details.amount),
  };

  const insertionIndex = findInsertionIndex(userTransactions, transaction);
  userTransactions.splice(insertionIndex, 0, transaction);
  adjustFollowingBalances(userTransactions, transaction.id, details.amount);

  return {
    type: 'TRANSACTION_ADDED',
    transaction: stripUserId(transaction),
  };
}

function createUpdatedTransaction(userTransactions) {
  const transaction = pickRandomItem(userTransactions);
  const previousBalance = transaction.balance;
  const nextBalance = Number((transaction.balance + (Math.random() * 40 - 20)).toFixed(2));
  transaction.balance = nextBalance;
  adjustFollowingBalances(userTransactions, transaction.id, nextBalance - previousBalance);

  return {
    type: 'TRANSACTION_UPDATED',
    transaction_id: transaction.id,
    balance: nextBalance,
  };
}

function createDeletedTransaction(userTransactions) {
  const transactionIndex = Math.floor(Math.random() * userTransactions.length);
  const [transaction] = userTransactions.splice(transactionIndex, 1);
  adjustFollowingBalances(userTransactions, transaction.id, -transaction.amount);

  return {
    type: 'TRANSACTION_DELETED',
    transaction_id: transaction.id,
  };
}

function pickNextAddUser(state) {
  const user = state.users[state.nextAddUserIndex % state.users.length];
  state.nextAddUserIndex = (state.nextAddUserIndex + 1) % state.users.length;
  return user;
}

function generateTransactionEvent(state) {
  state.eventTick += 1;
  const usersWithTransactions = state.users.filter((user) => {
    const transactions = state.transactionsByUser.get(user.id) ?? [];
    return transactions.length > 0;
  });
  const shouldCreateGuaranteedAdd =
    usersWithTransactions.length === 0 || state.eventTick % 3 === 1;
  const targetUser = shouldCreateGuaranteedAdd
    ? pickNextAddUser(state)
    : pickRandomItem(usersWithTransactions);
  const userTransactions = state.transactionsByUser.get(targetUser.id) ?? [];

  let payload;
  if (shouldCreateGuaranteedAdd || userTransactions.length === 0) {
    payload = createAddedTransaction(state, targetUser.id, userTransactions);
  } else {
    const action =
      userTransactions.length <= 2 ? 'update' : pickRandomItem(['update', 'delete']);
    payload =
      action === 'update'
        ? createUpdatedTransaction(userTransactions)
        : createDeletedTransaction(userTransactions);
  }

  state.transactionsByUser.set(targetUser.id, userTransactions);
  broadcastToUser(state, targetUser.id, payload);
}

function createRequestHandler(state) {
  return function handleRequest(req, res) {
    if (!req.url || !req.method) {
      sendError(res, 400, 'Malformed request');
      return;
    }

    const url = parseRequest(req);
    const pathname = url.pathname;

    if (req.method !== 'GET') {
      sendError(res, 405, 'Method not allowed');
      return;
    }

    if (pathname === '/' || pathname === '/health') {
      sendJson(res, 200, {
        service: 'reliability-explorer-mock-server',
        status: 'ok',
        port,
        endpoints: [
          '/api/users/:userId/reliability?from=YYYY-MM-DD',
          '/api/users/:userId/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD',
          '/api/users/:userId/transaction-events',
        ],
      });
      return;
    }

    const routeMatch = pathname.match(
      /^\/api\/users\/([^/]+)\/(reliability|transactions|transaction-events)$/,
    );

    if (!routeMatch) {
      sendError(res, 404, `Route '${pathname}' not found`);
      return;
    }

    const [, rawUserId, resource] = routeMatch;
    const userId = decodeURIComponent(rawUserId);

    if (!validateUser(res, userId, state.users)) {
      return;
    }

    if (resource === 'reliability') {
      const from = url.searchParams.get('from');

      if (!validateDateParam(res, 'from', from)) {
        return;
      }

      const result = state.reliabilityByKey.get(`${userId}:${from}`);

      if (!result) {
        sendError(res, 404, `No reliability data found for user '${userId}' and from '${from}'`);
        return;
      }

      const transactions = state.transactionsByUser.get(userId) ?? [];
      sendJson(
        res,
        200,
        createReliabilityResponse(
          result.baselineEntry,
          result.baselineRawMetrics,
          calculateRawReliabilityMetrics(transactions, from),
        ),
      );
      return;
    }

    if (resource === 'transactions') {
      const from = url.searchParams.get('from');
      const to = url.searchParams.get('to');

      if (!validateDateParam(res, 'from', from) || !validateDateParam(res, 'to', to)) {
        return;
      }

      if (compareDateStrings(from, to) > 0) {
        sendError(res, 400, "'from' must be less than or equal to 'to'");
        return;
      }

      const transactions = state.transactionsByUser.get(userId) ?? [];
      sendJson(res, 200, filterTransactions(transactions, userId, from, to));
      return;
    }

    if (resource === 'transaction-events') {
      sendSseHeaders(res);
      writeSseEvent(res, {
        event: 'connected',
        id: state.nextEventId++,
        data: {
          userId,
          connectedAt: new Date().toISOString(),
        },
      });
      registerClient(state, userId, res);
      return;
    }
  };
}

export function createAppServer() {
  const state = createInitialState();
  const server = createServer(createRequestHandler(state));

  const eventTimer = setInterval(() => {
    generateTransactionEvent(state);
  }, eventIntervalMs);
  eventTimer.unref();

  const heartbeatTimer = setInterval(() => {
    sendHeartbeat(state);
  }, heartbeatIntervalMs);
  heartbeatTimer.unref();

  server.on('close', () => {
    clearInterval(eventTimer);
    clearInterval(heartbeatTimer);
  });

  return server;
}

if (process.argv[1] === currentFilePath) {
  const server = createAppServer();

  server.listen(port, host, () => {
    console.log(`Reliability mock server listening on http://${host}:${port}`);
  });
}
