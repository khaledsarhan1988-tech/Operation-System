'use strict';

/**
 * One-time setup script for Google Drive integration.
 *
 * What it does:
 *   1. Verifies credentials.json can authenticate.
 *   2. Verifies the shared root folder is reachable.
 *   3. Creates Line subfolders (Ahmed Hassan, Dardasha) inside the root.
 *   4. Writes IDs to backend/src/config/drive-folders.json.
 *
 * Usage:
 *   ROOT_FOLDER_ID=<id> node src/scripts/setup-drive.js
 *
 * Or set DRIVE_ROOT_FOLDER_ID in .env and just run:
 *   node src/scripts/setup-drive.js
 *
 * The script is idempotent — running it again will not duplicate folders.
 */

const fs = require('fs');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const drive = require('../services/googleDrive.service');

// Lines must match VALID_LINES in sync.service.js
const LINES = ['Ahmed Hassan', 'Dardasha'];

const ROOT_ID =
  process.argv.find((a) => a.startsWith('--root='))?.split('=')[1] ||
  process.env.ROOT_FOLDER_ID ||
  process.env.DRIVE_ROOT_FOLDER_ID;

async function main() {
  console.log('=== Google Drive Setup ===\n');

  if (!ROOT_ID) {
    console.error('ERROR: Root folder ID not provided.');
    console.error('   Pass it as: node src/scripts/setup-drive.js --root=<FOLDER_ID>');
    console.error('   Or set DRIVE_ROOT_FOLDER_ID in backend/.env');
    process.exit(1);
  }

  process.env.DRIVE_ROOT_FOLDER_ID = ROOT_ID;

  // Step 1: verify connection
  console.log('[1/4] Verifying credentials and access to root folder...');
  let root;
  try {
    root = await drive.verifyConnection();
    console.log(`   ✓ Connected. Root folder: "${root.name}" (${root.id})\n`);
  } catch (err) {
    console.error('   ✗ Connection failed:', err.message);
    console.error('\n   Common fixes:');
    console.error('   - Ensure credentials.json exists in backend/ or Website/ folder');
    console.error('   - Share the Drive folder with the service account email as Editor');
    console.error('   - Verify the folder ID is correct (the part after /folders/ in the URL)');
    process.exit(1);
  }

  // Step 2: create line folders
  console.log('[2/4] Creating Line subfolders...');
  const lineFolders = {};
  for (const line of LINES) {
    const folder = await drive.getOrCreateFolder(ROOT_ID, line);
    lineFolders[line] = folder.id;
    console.log(`   ✓ ${line}: ${folder.id}`);
  }
  console.log('');

  // Step 3: save IDs to config
  console.log('[3/4] Saving folder IDs to config...');
  const configPath = path.join(__dirname, '..', 'config', 'drive-folders.json');
  const config = {
    rootFolderId: ROOT_ID,
    rootFolderName: root.name,
    lineFolders,
    fileTypeFolders: drive.FILE_TYPE_FOLDERS,
    createdAt: new Date().toISOString(),
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`   ✓ Saved to: ${configPath}\n`);

  // Step 4: summary
  console.log('[4/4] Summary:');
  console.log('   Drive structure ready:');
  console.log(`   └─ ${root.name}/`);
  for (const line of LINES) {
    console.log(`      └─ ${line}/  (year/month/day folders are created on demand)`);
  }
  console.log('');
  console.log('=== Setup complete ===');
  console.log('');
  console.log('Next steps:');
  console.log('   1. The Quality team can now upload files to:');
  console.log(`      ${root.name}/<Line>/<YYYY>/<MM>/<DD>/<File Type Folder>/`);
  console.log('   2. Add DRIVE_ROOT_FOLDER_ID to Railway env variables:');
  console.log(`      DRIVE_ROOT_FOLDER_ID=${ROOT_ID}`);
  console.log('   3. Add GOOGLE_CREDENTIALS_JSON to Railway (paste full JSON content).');
}

main().catch((err) => {
  console.error('\nFATAL:', err.message);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
