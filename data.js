// Case data (from the challenge brief) + seed inventory for the prototype.
const CASE = {
  before: { registered: 82000, mau: 39000, orders: 31200, aov: 452, repeat: 41, delivery: 29, cancel: 6, tickets: 3100, promo: 9.5, revenue: 21.8 },
  now:    { registered: 120000, mau: 46000, orders: 38500, aov: 486, repeat: 27, delivery: 37, cancel: 11, tickets: 5900, promo: 17, revenue: 26.1 },
  stores: 620, storesAtRisk: 0.18, acquisitionShare: 0.58,
  cancelReasons: [
    ['Product unavailable', 35, 'inv'], ['Customer cancelled (delay)', 27, ''],
    ['Store rejected order', 18, 'inv'], ['Delivery partner unavailable', 12, ''], ['Other', 8, '']
  ],
  tickets: [
    ['Refund status', 29, 'inv'], ['Delayed delivery', 24, ''], ['Missing / unavailable products', 19, 'inv'],
    ['Coupon problems', 13, ''], ['Incorrect orders', 9, ''], ['Other', 6, '']
  ]
};

// Assumptions used by the Impact tab (not in the brief)
const ASSUME = { ordersPerRepeatCustomer: 1.8, costPerTicket: 55, rampMonths12: 0.5 };

const STORES = [
  { id: 'lk', name: 'Sri Lakshmi Kirana', cat: 'Grocery',    cadence: 48, note: 'Updates stock every ~2 days' },
  { id: 'fm', name: 'FreshMart Daily',    cat: 'Grocery',    cadence: 4,  note: 'Updates stock every few hours' },
  { id: 'bb', name: "Baker's Basket",     cat: 'Bakery',     cadence: 6,  note: 'Updates stock twice a day' },
  { id: 'cc', name: 'CityCare Pharmacy',  cat: 'Pharmacy',   cadence: 24, note: 'Updates stock daily' },
  { id: 'pp', name: 'Paper Plus',         cat: 'Stationery', cadence: 72, note: 'Updates stock every ~3 days' }
];

// id, store, name, group (substitutes), price, vol (expected stock-outs/day), h (hours since last confirmed), actual (hidden truth), pop (1-5 demand)
const I = (id, store, name, group, price, vol, h, actual, pop = 3) => ({ id, store, name, group, price, vol, h, listed: true, actual, pop });
const SEED_ITEMS = [
  I('l1','lk','Toned Milk 500ml','milk',30,.9,30,false,5),
  I('l2','lk','Eggs (12)','eggs',84,.8,26,false,4),
  I('l3','lk','Curd 400g','curd',40,.9,22,true,3),
  I('l4','lk','Paneer 200g','paneer',95,.9,30,false,2),
  I('l5','lk','Basmati Rice 1kg','rice',120,.12,40,true,3),
  I('l6','lk','Atta 5kg','atta',260,.15,40,true,4),
  I('l7','lk','Toor Dal 1kg','dal',165,.15,36,true,3),
  I('l8','lk','Sunflower Oil 1L','oil',150,.12,44,true,3),
  I('l9','lk','Tea 250g','tea',110,.1,46,true,2),

  I('f1','fm','Toned Milk 500ml','milk',32,.9,2,true,5),
  I('f2','fm','Eggs (12)','eggs',90,.8,3,true,4),
  I('f3','fm','Curd 400g','curd',42,.9,2,true,3),
  I('f4','fm','Paneer 200g','paneer',98,.9,3,true,2),
  I('f5','fm','Banana (1 dozen)','banana',55,1.2,4,true,3),
  I('f6','fm','Tomato 1kg','tomato',40,1.2,3,true,4),
  I('f7','fm','Atta 5kg','atta',270,.15,3,true,4),

  I('b1','bb','Whole Wheat Bread','bread',45,1.5,5,true,5),
  I('b2','bb','Multigrain Bread','bread',60,1.5,8,false,3),
  I('b3','bb','Butter Croissant','croissant',50,1.5,4,true,3),
  I('b4','bb','Veg Puff','puff',25,1.5,6,true,3),
  I('b5','bb','Chocolate Cake Slice','cake',80,1.2,7,true,2),

  I('c1','cc','Paracetamol 500mg (10)','para',30,.1,20,true,4),
  I('c2','cc','ORS Sachet','ors',22,.2,18,true,3),
  I('c3','cc','Antiseptic Liquid 100ml','antiseptic',85,.1,22,true,2),
  I('c4','cc','Hand Sanitizer 200ml','sanitizer',99,.15,20,false,3),
  I('c5','cc','Vitamin C Tablets','vitc',120,.1,23,true,2),
  I('c6','cc','Cough Lozenges','lozenge',35,.2,16,true,2),

  I('p1','pp','A4 Notebook 200pg','notebook',70,.1,60,true,4),
  I('p2','pp','Gel Pens (5)','pen',60,.15,66,false,4),
  I('p3','pp','Highlighters (4)','highlighter',90,.1,50,true,2),
  I('p4','pp','Sticky Notes','sticky',45,.1,48,true,2),
  I('p5','pp','Graph Paper Pad','graph',55,.1,60,true,2)
];
