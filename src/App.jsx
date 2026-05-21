import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ScrollToTop from './components/ScrollToTop';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Market from './pages/Market';
//import Prediction from './pages/Prediction';
import About from './pages/About';
import Ecosystem from './pages/Ecosystem';
import Portfolio from './pages/Portfolio';
import CoinDetail from './pages/CoinDetail';
import Learn from './pages/Learn';
import NFTs from './pages/NFTs';
import Exchanges from './pages/Exchanges';
import Login from './pages/Login';
import Signup from './pages/Signup';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './AuthContext';

function App() {
  const { user, loading } = useAuth();

  return (
    <Router>
      <ScrollToTop />
      <div className="min-h-screen flex flex-col">
        <Navbar />
        <main className="flex-grow">
          <Routes>
            {/* Entry Point */}
            <Route 
              path="/" 
              element={user ? <Home /> : <Navigate to="/login" replace />} 
            />

            {/* Public Routes */}
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />

            {/* Protected Routes */}
            <Route path="/market" element={<ProtectedRoute><Market /></ProtectedRoute>} />
            <Route path="/ecosystem" element={<ProtectedRoute><Ecosystem /></ProtectedRoute>} />
            <Route path="/portfolio" element={<ProtectedRoute><Portfolio /></ProtectedRoute>} />
            <Route path="/coin/:id" element={<ProtectedRoute><CoinDetail /></ProtectedRoute>} />
            <Route path="/learn" element={<ProtectedRoute><Learn /></ProtectedRoute>} />
            <Route path="/nfts" element={<ProtectedRoute><NFTs /></ProtectedRoute>} />
            <Route path="/exchanges" element={<ProtectedRoute><Exchanges /></ProtectedRoute>} />
          </Routes>
        </main>
        <Footer />
      </div>
    </Router>
  );
}

export default App;
