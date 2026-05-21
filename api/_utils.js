function normalizeHttpUrl(value) {
  const trimmed = String(value || '').trim().replace(/\/+$/, '');
  if (!trimmed) {
    return '';
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

module.exports = {
  normalizeHttpUrl
};