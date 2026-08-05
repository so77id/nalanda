import { useState } from 'react'
import { LanguageContext } from './useLanguage.js'

export function LanguageProvider({ children, defaultLanguage = 'cpp' }) {
  const [languageId, setLanguageId] = useState(defaultLanguage)
  return (
    <LanguageContext.Provider value={{ languageId, setLanguageId }}>
      {children}
    </LanguageContext.Provider>
  )
}
