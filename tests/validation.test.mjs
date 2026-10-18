import test from 'node:test';
import assert from 'node:assert/strict';

const toLatin = (s) =>
  s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)));

const phoneOk = (v) => {
  const d = toLatin(v).replace(/[\s-]/g, '');
  return d === '' || /^(07\d{9}|\+9647\d{9}|009647\d{9})$/.test(d);
};

const numOk = (v) => {
  const d = toLatin(v).trim();
  return d === '' || /^\d+(\.\d+)?$/.test(d);
};

const errorsOf = (s) => {
  const e = {};
  if (!s.name || !s.name.trim()) e.name = 'اسم العقار مطلوب.';
  if (!s.street || !s.street.trim()) e.street = 'حدد المنطقة أو الشارع.';
  if (!phoneOk(s.phone || '')) e.phone = 'رقم هاتف عراقي غير صحيح (مثال: 07xxxxxxxxx).';
  if (!numOk(s.height || '')) e.height = 'أدخل رقماً صحيحاً للارتفاع.';
  if (!numOk(s.width || '')) e.width = 'أدخل رقماً صحيحاً للعرض.';
  if (!numOk(s.price || '')) e.price = 'أدخل رقماً صحيحاً للتوقع المالي.';
  return e;
};

test('toLatin converts Arabic and Persian numerals correctly', () => {
  assert.equal(toLatin('٠٧٧٠١٢٣٤٥٦٧'), '07701234567');
  assert.equal(toLatin('۰۷۸۰۱۲۳۴۵۶۷'), '07801234567');
  assert.equal(toLatin('12345'), '12345');
});

test('phoneOk validates Iraqi phone numbers across all formats', () => {
  assert.equal(phoneOk(''), true);
  assert.equal(phoneOk('07701234567'), true);
  assert.equal(phoneOk('0780 123 4567'), true);
  assert.equal(phoneOk('٠٧٧٠١٢٣٤٥٦٧'), true);
  assert.equal(phoneOk('+9647701234567'), true);
  assert.equal(phoneOk('009647701234567'), true);

  // Invalid formats
  assert.equal(phoneOk('12345'), false);
  assert.equal(phoneOk('06601234567'), false);
  assert.equal(phoneOk('0770123456'), false); // 10 digits instead of 11
  assert.equal(phoneOk('077012345678'), false); // 12 digits
  assert.equal(phoneOk('abc'), false);
});

test('numOk validates decimal numbers and Arabic numerals', () => {
  assert.equal(numOk(''), true);
  assert.equal(numOk('12'), true);
  assert.equal(numOk('12.5'), true);
  assert.equal(numOk('١٢.٥'), true);
  assert.equal(numOk('abc'), false);
  assert.equal(numOk('12.3.4'), false);
});

test('errorsOf reports required and invalid fields accurately', () => {
  const invalid = {
    name: '',
    street: '',
    phone: '123',
    height: 'abc',
    width: 'xyz',
    price: 'bad',
  };
  const errs = errorsOf(invalid);
  assert.ok(errs.name);
  assert.ok(errs.street);
  assert.ok(errs.phone);
  assert.ok(errs.height);
  assert.ok(errs.width);
  assert.ok(errs.price);

  const valid = {
    name: 'برج الرواد',
    street: 'شارع 17 تموز',
    phone: '07701234567',
    height: '4.5',
    width: '12',
    price: '1500000',
  };
  assert.deepEqual(errorsOf(valid), {});
});
