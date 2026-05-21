import { Link } from 'react-router-dom';
import { Globe, Share2 } from 'lucide-react';

const Footer = () => {
  return (
    <footer className="bg-[#faf1f4] w-full py-16 px-12 rounded-t-[3rem] mt-20">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-12 max-w-7xl mx-auto">
        <div className="space-y-6">
          <Link to="/" className="text-xl font-bold text-[#556069]">Agamin</Link>
          <p className="font-headline text-lg leading-relaxed text-[#705953]">
            The Ethereal Vault for modern finance. Secure, serene, and sophisticated.
          </p>
          <div className="flex gap-4">
            <a href="#" className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center hover:bg-[#c5d0db] transition-colors group">
              <Globe size={18} className="text-[#556069] group-hover:scale-110 transition-transform" />
            </a>
            <a href="#" className="w-10 h-10 rounded-full bg-white/50 flex items-center justify-center hover:bg-[#c5d0db] transition-colors group">
              <Share2 size={18} className="text-[#556069] group-hover:scale-110 transition-transform" />
            </a>
          </div>
        </div>
        
        <div className="space-y-4">
          <h4 className="font-bold text-[#556069]">Platform</h4>
          <ul className="space-y-2">
            <li><Link className="text-[#705953]/70 hover:text-[#556069] hover:translate-x-1 transition-all inline-block" to="/">Home</Link></li>
            <li><Link className="text-[#705953]/70 hover:text-[#556069] hover:translate-x-1 transition-all inline-block" to="/market">Cryptocurrencies</Link></li>
          </ul>
        </div>

        <div className="space-y-4">
          <h4 className="font-bold text-[#556069]">Company</h4>
          <ul className="space-y-2">
            <li><a className="text-[#705953]/70 hover:text-[#556069] hover:translate-x-1 transition-all inline-block" href="#">Privacy Policy</a></li>
            <li><a className="text-[#705953]/70 hover:text-[#556069] hover:translate-x-1 transition-all inline-block" href="#">Terms of Service</a></li>
            <li><a className="text-[#705953]/70 hover:text-[#556069] hover:translate-x-1 transition-all inline-block" href="#">Contact Us</a></li>
          </ul>
        </div>
      </div>
      <div className="mt-16 pt-8 border-t border-[#556069]/10 max-w-7xl mx-auto text-center">
        <p className="text-[#705953]/50 text-sm">© 2026 Agamin. Built for the Ethereal Vault.</p>
      </div>
    </footer>
  );
};

export default Footer;
