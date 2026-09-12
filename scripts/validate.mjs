#!/usr/bin/env node

/**
 * Validation script for Picklo
 * Runs basic checks to ensure the repository is in a valid state
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

let errors = [];

// Check package.json exists
const packageJsonPath = path.join(rootDir, 'package.json');
if (!fs.existsSync(packageJsonPath)) {
  errors.push('❌ package.json not found');
} else {
  console.log('✓ package.json found');
}

// Check for common required files
const requiredFiles = [
  'package.json',
  '.gitignore',
];

requiredFiles.forEach(file => {
  const filePath = path.join(rootDir, file);
  if (fs.existsSync(filePath)) {
    console.log(`✓ ${file} exists`);
  } else {
    errors.push(`❌ ${file} not found`);
  }
});

// Summary
console.log('');
if (errors.length > 0) {
  console.error('Validation failed:');
  errors.forEach(err => console.error(err));
  process.exit(1);
} else {
  console.log('✅ All validations passed!');
  process.exit(0);
}
