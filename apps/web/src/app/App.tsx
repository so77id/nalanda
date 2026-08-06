import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Landing } from './Landing';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
      </Routes>
    </BrowserRouter>
  );
}
