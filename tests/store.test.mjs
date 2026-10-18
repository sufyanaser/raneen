import test from 'node:test';
import assert from 'node:assert/strict';

const dimensionText = (s) =>
  s.height || s.width
    ? `ارتفاع ${s.height || '—'} × عرض ${s.width || '—'} متر`
    : s.dimensions || '';

const priceText = (s) => [s.price, s.priceCurrency].filter(Boolean).join(' ');

const normalizeSearch = (s) =>
  (s || '')
    .toString()
    .toLowerCase()
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();

const matchesSite = (site, query) => {
  const q = normalizeSearch(query);
  if (!q) return true;
  const searchable = normalizeSearch(
    [
      site.name,
      site.street,
      site.owner,
      site.phone,
      site.createdName,
      site.kind,
      site.position,
      site.notes,
    ].filter(Boolean).join(' ')
  );
  return searchable.includes(q);
};

test('dimensionText produces readable Arabic measurement strings', () => {
  assert.equal(dimensionText({ height: '4', width: '12' }), 'ارتفاع 4 × عرض 12 متر');
  assert.equal(dimensionText({ height: '3' }), 'ارتفاع 3 × عرض — متر');
  assert.equal(dimensionText({ width: '8' }), 'ارتفاع — × عرض 8 متر');
  assert.equal(dimensionText({ dimensions: '3x6 متر' }), '3x6 متر');
  assert.equal(dimensionText({}), '');
});

test('priceText formats amount and currency properly', () => {
  assert.equal(priceText({ price: '1500000', priceCurrency: 'دينار عراقي' }), '1500000 دينار عراقي');
  assert.equal(priceText({ price: '1000', priceCurrency: 'دولار أمريكي' }), '1000 دولار أمريكي');
  assert.equal(priceText({ price: '500' }), '500');
  assert.equal(priceText({}), '');
});

test('matchesSite searches across name, street, owner, phone, and surveyor with normalization', () => {
  const site = {
    name: 'برج الأمل التجاري',
    street: 'شارع فلسطين — تقاطع المستشفى',
    owner: 'أحمد شاكر',
    phone: '07701234567',
    createdName: 'سفيان',
    kind: 'تجاري',
    position: 'واجهة',
    notes: 'موقع مميز جداً على الإشارة الضوئية',
  };

  // Name search
  assert.equal(matchesSite(site, 'الأمل'), true);
  assert.equal(matchesSite(site, 'الامل'), true); // normalized alif

  // Street search
  assert.equal(matchesSite(site, 'فلسطين'), true);

  // Owner search
  assert.equal(matchesSite(site, 'احمد'), true);

  // Phone search (both Latin and Arabic numerals)
  assert.equal(matchesSite(site, '0770'), true);
  assert.equal(matchesSite(site, '٠٧٧٠'), true);

  // Surveyor search
  assert.equal(matchesSite(site, 'سفيان'), true);

  // Notes search
  assert.equal(matchesSite(site, 'الإشارة'), true);

  // Unrelated search
  assert.equal(matchesSite(site, 'البصرة'), false);
});
