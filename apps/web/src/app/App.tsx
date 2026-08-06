import { BrowserRouter, Route, Routes } from 'react-router-dom';

import { Landing } from './Landing';
import { SamplePage } from './SamplePage';

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/sample" element={<SamplePage />} />
      </Routes>
    </BrowserRouter>
  );
}
