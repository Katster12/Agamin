import { Link, useLocation } from 'react-router-dom';
import { Bell, User, LogOut } from 'lucide-react';
import { motion } from 'framer-motion';
import { useAuth } from '../AuthContext';

const Navbar = () => {
  const location = useLocation();
  const { user, logout } = useAuth();
  
  const navLinks = [
    { name: 'Home', path: '/' },
    { name: 'Cryptocurrencies', path: '/market' },
  ];

  return (
    <header className="fixed top-0 w-full z-50 bg-[#fff7fa]/80 backdrop-blur-xl border-b border-[#556069]/10 shadow-sm shadow-[#556069]/5">
      <nav className="flex justify-between items-center px-8 h-20 max-w-screen-2xl mx-auto">
        <div className="flex items-center gap-12">
          <Link to="/" className="text-2xl font-bold tracking-tighter text-[#556069]">Agamin</Link>
          <div className="hidden lg:flex items-center gap-8">
            {navLinks.map((link) => (
              <Link
                key={link.name}
                to={link.path}
                className={`font-headline tracking-tight headline-sm transition-all duration-300 ${
                  location.pathname === link.path
                    ? 'text-[#556069] font-bold border-b-2 border-[#556069] pb-1'
                    : 'text-[#556069]/60 hover:text-[#556069]'
                }`}
              >
                {link.name}
              </Link>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <button className="p-2 hover:bg-[#faf1f4] rounded-full transition-all duration-300 hover:scale-110 active:scale-95">
            <Bell size={20} className="text-[#556069]" />
          </button>
          
          {user ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 bg-white/50 rounded-full border border-gray-100">
                <User size={16} className="text-[#556069]" />
                <span className="text-sm font-bold text-[#556069]">{user.username}</span>
              </div>
              <button 
                onClick={logout}
                className="p-2 hover:bg-rose-50 text-rose-500 rounded-full transition-all duration-300 hover:scale-110 active:scale-95"
                title="Logout"
              >
                <LogOut size={20} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Link 
                to="/login" 
                className="px-5 py-2 text-sm font-bold text-[#556069] hover:bg-[#faf1f4] rounded-full transition-all"
              >
                Login
              </Link>
              <Link 
                to="/signup" 
                className="px-5 py-2 text-sm font-bold bg-[#556069] text-white rounded-full hover:shadow-lg hover:shadow-[#556069]/20 transition-all"
              >
                Join Now
              </Link>
            </div>
          )}
        </div>
      </nav>
    </header>
  );
};

export default Navbar;
