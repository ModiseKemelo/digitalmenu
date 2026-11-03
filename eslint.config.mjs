import {FlatCompat} from '@eslint/eslintrc';

const compat = new FlatCompat({baseDirectory: import.meta.dirname});

export default [
  {ignores: ['.next/**', 'node_modules/**', 'functions/lib/**', 'functions/node_modules/**', '.local/**']},
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    rules: {
      // The provisioning scripts and tests are console tools by design.
      'no-console': 'off',
    },
  },
];
