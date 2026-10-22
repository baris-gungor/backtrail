// @ts-check
import eslint from '@eslint/js';
import pluginVue from 'eslint-plugin-vue';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import vueParser from 'vue-eslint-parser';

export default tseslint.config(
  { ignores: ['dist/**', 'src/api/schema.d.ts', 'scripts/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  ...pluginVue.configs['flat/recommended'],
  {
    files: ['**/*.vue', '**/*.ts'],
    languageOptions: {
      globals: globals.browser,
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false, properties: false } },
      ],
      // `null as string | null` is how the reactive form state gets its type.
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      // Prettier owns formatting; these only fight it.
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/multiline-html-element-content-newline': 'off',
      'vue/first-attribute-linebreak': 'off',
      'vue/html-closing-bracket-spacing': 'off',
      // Single-word view names are fine here.
      'vue/multi-word-component-names': 'off',
    },
  },
  { files: ['**/*.config.*'], ...tseslint.configs.disableTypeChecked },
);
