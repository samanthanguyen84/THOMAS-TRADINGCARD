// Demo data seeder. Run with `npm run seed` (or `node server/seed.js`).
// Safe to run on an existing DB — it only inserts rows.
import db from './db.js';

function daysAgo(n, time = '15:00:00') {
  const ymd = new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return `${ymd} ${time}`;
}

function dateOnly(n) {
  return daysAgo(n).slice(0, 10);
}

const insertCard = db.prepare(`
  INSERT INTO cards (name, set_name, card_number, variant, condition, quantity,
                     cost_basis, market_price, price_updated_at, tcg_card_id, notes)
  VALUES (@name, @set_name, @card_number, @variant, @condition, @quantity,
          @cost_basis, @market_price, datetime('now'), @tcg_card_id, @notes)
`);
const insertShow = db.prepare(`
  INSERT INTO shows (name, date, venue, table_fee, notes) VALUES (?, ?, ?, ?, ?)
`);
const insertTransaction = db.prepare(`
  INSERT INTO transactions (type, card_id, show_id, quantity, unit_price, total, description, date)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);
const insertWatch = db.prepare(`
  INSERT INTO watches (retailer, sku, product_name, zip_code, store_id, active, last_status, last_checked)
  VALUES (?, ?, ?, ?, ?, 1, ?, datetime('now'))
`);
const insertAlert = db.prepare('INSERT INTO alerts (watch_id, message, seen) VALUES (?, ?, 0)');

const CARDS = [
  { name: 'Charizard ex', set_name: 'Obsidian Flames', card_number: '125/197', variant: 'holofoil', condition: 'NM', quantity: 3, cost_basis: 28, market_price: 42.5, tcg_card_id: 'sv3-125', notes: '' },
  { name: 'Pikachu', set_name: '151', card_number: '025/165', variant: 'normal', condition: 'NM', quantity: 12, cost_basis: 0.5, market_price: 1.25, tcg_card_id: 'sv3pt5-25', notes: 'Bulk box staple' },
  { name: 'Umbreon VMAX (Alternate Art)', set_name: 'Evolving Skies', card_number: '215/203', variant: 'holofoil', condition: 'NM', quantity: 1, cost_basis: 420, market_price: 615, tcg_card_id: 'swsh7-215', notes: 'Moonbreon — display case only' },
  { name: 'Giratina V (Alternate Art)', set_name: 'Lost Origin', card_number: '186/196', variant: 'holofoil', condition: 'LP', quantity: 2, cost_basis: 95, market_price: 128.75, tcg_card_id: 'swsh11-186', notes: '' },
  { name: 'Lugia V (Alternate Art)', set_name: 'Silver Tempest', card_number: '186/195', variant: 'holofoil', condition: 'NM', quantity: 1, cost_basis: 150, market_price: 189.99, tcg_card_id: 'swsh12-186', notes: '' },
  { name: 'Mew ex', set_name: '151', card_number: '151/165', variant: 'holofoil', condition: 'NM', quantity: 2, cost_basis: 24, market_price: 33.5, tcg_card_id: 'sv3pt5-151', notes: '' },
  { name: 'Rayquaza VMAX (Alternate Art)', set_name: 'Evolving Skies', card_number: '218/203', variant: 'holofoil', condition: 'MP', quantity: 1, cost_basis: 310, market_price: 410, tcg_card_id: 'swsh7-218', notes: 'Light whitening on back corners' },
  { name: 'Charizard', set_name: 'Base', card_number: '4/102', variant: 'unlimitedHolofoil', condition: 'HP', quantity: 1, cost_basis: 220, market_price: 325, tcg_card_id: 'base1-4', notes: 'From childhood collection' },
  { name: 'Iono', set_name: 'Paldea Evolved', card_number: '185/193', variant: 'holofoil', condition: 'NM', quantity: 4, cost_basis: 22, market_price: 31, tcg_card_id: 'sv2-185', notes: '' },
  { name: 'Miraidon ex', set_name: 'Scarlet & Violet', card_number: '081/198', variant: 'holofoil', condition: 'NM', quantity: 5, cost_basis: 3.5, market_price: 5.25, tcg_card_id: 'sv1-81', notes: '' },
];

const seed = db.transaction(() => {
  const cardIds = CARDS.map((card) => insertCard.run(card).lastInsertRowid);
  const [charizardEx, pikachu, umbreon, giratina, , mewEx, rayquaza, , iono, miraidon] = cardIds;

  const show1 = insertShow.run(
    'Riverside Card Show', dateOnly(35), 'Riverside Convention Center', 60, 'Monthly show, good foot traffic'
  ).lastInsertRowid;
  const show2 = insertShow.run(
    'Lakewood Collectibles Expo', dateOnly(7), 'Lakewood Expo Hall', 75, ''
  ).lastInsertRowid;

  // Purchases spread over the last ~3 months.
  insertTransaction.run('purchase', umbreon, null, 1, 420, 420, 'Bought 1x Umbreon VMAX (Alternate Art)', daysAgo(85, '10:15:00'));
  insertTransaction.run('purchase', charizardEx, null, 4, 28, 112, 'Bought 4x Charizard ex', daysAgo(80, '12:00:00'));
  insertTransaction.run('purchase', pikachu, null, 15, 0.5, 7.5, 'Bought 15x Pikachu', daysAgo(72, '17:40:00'));
  insertTransaction.run('purchase', rayquaza, null, 1, 310, 310, 'Bought 1x Rayquaza VMAX (Alternate Art)', daysAgo(60, '11:05:00'));
  insertTransaction.run('purchase', giratina, null, 2, 95, 190, 'Bought 2x Giratina V (Alternate Art)', daysAgo(48, '14:20:00'));
  insertTransaction.run('purchase', iono, null, 5, 22, 110, 'Bought 5x Iono', daysAgo(40, '16:30:00'));
  insertTransaction.run('purchase', mewEx, null, 2, 24, 48, 'Bought 2x Mew ex', daysAgo(20, '13:10:00'));
  insertTransaction.run('purchase', miraidon, null, 6, 3.5, 21, 'Bought 6x Miraidon ex', daysAgo(14, '09:45:00'));

  // Riverside Card Show.
  insertTransaction.run('sale', charizardEx, show1, 1, 34, 34, 'Sold 1x Charizard ex', daysAgo(35, '10:30:00'));
  insertTransaction.run('sale', pikachu, show1, 3, 1, 3, 'Sold 3x Pikachu', daysAgo(35, '11:45:00'));
  insertTransaction.run('sale', iono, show1, 1, 25, 25, 'Sold 1x Iono', daysAgo(35, '14:10:00'));
  insertTransaction.run('expense', null, show1, 1, 18.5, 18.5, 'Gas to Riverside', daysAgo(35, '07:30:00'));
  insertTransaction.run('expense', null, show1, 1, 12.75, 12.75, 'Lunch', daysAgo(35, '12:30:00'));

  // Supplies between shows.
  insertTransaction.run('expense', null, null, 1, 24.99, 24.99, 'Card sleeves and toploaders', daysAgo(10, '18:05:00'));

  // Lakewood Collectibles Expo.
  insertTransaction.run('sale', miraidon, show2, 1, 4.25, 4.25, 'Sold 1x Miraidon ex', daysAgo(7, '10:50:00'));
  insertTransaction.run('sale', null, show2, 1, 18, 18, 'Sold bulk common lot', daysAgo(7, '13:25:00'));
  insertTransaction.run('expense', null, show2, 1, 15, 15, 'Gas to Lakewood', daysAgo(7, '07:45:00'));
  insertTransaction.run('adjustment', null, show2, 1, 0, -4.5, 'Cash drawer came up short', daysAgo(7, '17:00:00'));

  const targetWatch = insertWatch.run(
    'target', '93954435', 'Pokemon TCG: Prismatic Evolutions Elite Trainer Box', '78704', '1077', 'in_stock'
  ).lastInsertRowid;
  insertWatch.run(
    'bestbuy', '6614325', 'Pokemon TCG: Scarlet & Violet 151 Ultra Premium Collection', '', '', 'unknown'
  );
  insertAlert.run(
    targetWatch,
    '🚨 RESTOCK: Pokemon TCG: Prismatic Evolutions Elite Trainer Box is IN STOCK at target — https://www.target.com/p/-/A-93954435'
  );
});
seed();

const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
const sumByType = (type) =>
  db.prepare('SELECT COALESCE(SUM(total), 0) AS total FROM transactions WHERE type = ?').get(type).total;

console.log('Seed complete. Database now contains:');
console.log(`  cards:        ${count('cards')}`);
console.log(`  shows:        ${count('shows')}`);
console.log(`  transactions: ${count('transactions')}`);
console.log(`    sales       $${sumByType('sale').toFixed(2)}`);
console.log(`    purchases   $${sumByType('purchase').toFixed(2)}`);
console.log(`    expenses    $${sumByType('expense').toFixed(2)}`);
console.log(`    adjustments $${sumByType('adjustment').toFixed(2)}`);
console.log(`  watches:      ${count('watches')}`);
console.log(`  alerts:       ${count('alerts')}`);
