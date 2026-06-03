const failures = [];
for (const key of ['HELMR_API_TOKEN', 'HELMR_ALLOWED_ORIGINS', 'HELMR_DATA_DIR', 'HELMR_CONFIG_DIR', 'HELMR_AUDIT_LOG', 'HELMR_BACKUP_DIR']) {
  if (!process.env[key] || !String(process.env[key]).trim()) failures.push(`${key} is required for real deployment verification.`);
}
if (process.env.HELMR_API_TOKEN && process.env.HELMR_API_TOKEN.length < 32) failures.push('HELMR_API_TOKEN must be at least 32 characters.');
if (process.env.HELMR_ALLOWED_ORIGINS === '*') failures.push('HELMR_ALLOWED_ORIGINS cannot be wildcard for deployment verification.');
if (process.env.HELMR_PRODUCTION !== 'true' && process.env.NODE_ENV !== 'production') failures.push('Set HELMR_PRODUCTION=true or NODE_ENV=production for deployment verification.');
if (failures.length) {
  console.error('Deployment verification failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}
console.log('Deployment verification passed explicit secret/origin/state checks.');
