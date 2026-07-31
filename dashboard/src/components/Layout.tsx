import { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useRealtime } from '../stores/useRealtime';

const navItems = [
  { path: '/', label: 'Dashboard', icon: '▦' },
  { path: '/opportunities', label: 'Opportunities', icon: '⚡' },
  { path: '/trades', label: 'Trade History', icon: '⟳' },
  { path: '/positions', label: 'Positions', icon: '◈' },
  { path: '/settings', label: 'Settings', icon: '⚙' },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { connected } = useRealtime();

  return (
    <div className="min-h-screen bg-gray-950 flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-30
        w-64 bg-gray-900 border-r border-gray-800
        transform transition-transform duration-200 ease-in-out
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        flex flex-col
      `}>
        {/* Logo */}
        <div className="h-16 flex items-center px-6 border-b border-gray-800">
          <div className="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center mr-3">
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">SolAribot</h1>
            <span className="text-[10px] text-gray-500">Trading Dashboard</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
          {navItems.map(({ path, label, icon }) => (
            <NavLink
              key={path}
              to={path}
              end={path === '/'}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                    : 'text-gray-400 hover:text-gray-200 hover:bg-gray-800/50'
                }`
              }
            >
              <span className="w-8 text-center text-base">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>

        {/* Connection status */}
        <div className="px-6 py-4 border-t border-gray-800">
          <div className="flex items-center space-x-2">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className={`text-xs ${connected ? 'text-green-400' : 'text-red-400'}`}>
              {connected ? 'Connected' : 'Disconnected'}
            </span>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 bg-gray-900 border-b border-gray-800 flex items-center px-4 lg:px-6">
          <button
            onClick={() => setSidebarOpen(true)}
            className="lg:hidden p-2 text-gray-400 hover:text-white mr-2"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <div className="flex-1" />

          {/* Connection indicator */}
          <div className="flex items-center space-x-3">
            <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-500'}`} />
            <span className={`text-xs hidden sm:inline ${connected ? 'text-green-400' : 'text-red-400'}`}>
              {connected ? 'Live' : 'Offline'}
            </span>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}