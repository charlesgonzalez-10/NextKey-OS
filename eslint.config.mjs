import nextConfig from 'eslint-config-next'

export default [
  ...nextConfig,
  {
    // eslint-plugin-react-hooks v7 (shipped with eslint-config-next 16) introduced
    // several new rules that flag patterns throughout the existing codebase.
    // The codebase predates these rules; downgrading to warn preserves visibility
    // without blocking CI until the patterns are addressed file-by-file.
    //
    // react/no-unescaped-entities: apostrophes in pre-existing JSX string content.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/static-components':   'warn',
      'react-hooks/immutability':         'warn',
      'react-hooks/error-boundaries':     'warn',
      'react-hooks/purity':               'warn',
      'react-hooks/use-memo':             'warn',
      'react/no-unescaped-entities':      'warn',
    },
  },
]
