import { defineConfig } from 'oxlint'

export default defineConfig({
    plugins: ['eslint', 'typescript', 'unicorn', 'oxc', 'import'],
    env: {
        node: true,
    },
    ignorePatterns: ['**/dist/**', '**/coverage/**'],
    rules: {
        curly: ['error', 'all'],
        eqeqeq: 'error',
        'prefer-rest-params': 'error',
        'prefer-spread': 'error',
        'no-array-constructor': 'error',
        'no-constant-condition': 'error',
        'no-debugger': 'error',
        'no-duplicate-imports': 'error',
        'no-unused-expressions': 'error',
        'no-unused-vars': 'error',
        '@typescript-eslint/no-empty-object-type': 'error',
        '@typescript-eslint/no-explicit-any': 'error',
        '@typescript-eslint/no-namespace': 'error',
        '@typescript-eslint/no-require-imports': 'error',
        '@typescript-eslint/no-unnecessary-type-constraint': 'error',
        '@typescript-eslint/no-unsafe-function-type': 'error',
        '@typescript-eslint/prefer-namespace-keyword': 'error',
        'import/no-cycle': 'error',
    },
})
