import { createContext, useContext, useState } from 'react'

const LanguageContext = createContext(null)

export function LanguageProvider({ children, defaultLanguage = 'cpp' }) {
  const [languageId, setLanguageId] = useState(defaultLanguage)
  return (
    <LanguageContext.Provider value={{ languageId, setLanguageId }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) {
    throw new Error('useLanguage must be used inside <LanguageProvider>')
  }
  return ctx
}
