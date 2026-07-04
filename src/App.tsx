import { useState } from 'react';
import Sidebar from './components/Sidebar';
import Dashboard from './components/Dashboard';
import OrdersList from './components/OrdersList';
import OrderDetail from './components/OrderDetail';
import CustomersList from './components/CustomersList';

type Page = 'dashboard' | 'orders' | 'customers';

function App() {
  const [page, setPage]               = useState<Page>('dashboard');
  const [selectedOrderId, setSelected] = useState<string | null>(null);

  return (
    <div className="app-layout">
      <Sidebar current={page} onNavigate={setPage} />
      <main className="app-main">
        {page === 'dashboard' && <Dashboard onOrderClick={setSelected} />}
        {page === 'orders'    && <OrdersList onOrderClick={setSelected} />}
        {page === 'customers' && <CustomersList />}
      </main>
      {selectedOrderId && (
        <OrderDetail orderId={selectedOrderId} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

export default App;
