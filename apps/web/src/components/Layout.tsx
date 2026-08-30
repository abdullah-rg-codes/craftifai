import { Link, NavLink, Outlet } from 'react-router';
import { useAuth } from '../auth.js';

export function Layout() {
  const { session, logout } = useAuth();
  const isAdmin = session?.role === 'administrator';

  return (
    <div className="app">
      <header className="top">
        <Link to={isAdmin ? '/' : '/playground'} className="brand">
          CraftifAI
        </Link>
        <nav>
          {isAdmin ? (
            <>
              <NavLink to="/" end>
                Overview
              </NavLink>
              <NavLink to="/members">Team</NavLink>
              <NavLink to="/credits">Credits</NavLink>
              <NavLink to="/usage">Usage</NavLink>
              <NavLink to="/model">Model</NavLink>
              <NavLink to="/audit">Audit</NavLink>
              <NavLink to="/playground">Playground</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/playground">Playground</NavLink>
              <NavLink to="/me/usage">My usage</NavLink>
            </>
          )}
        </nav>
        <div className="session">
          <span>
            {session?.email} · {session?.role}
          </span>
          <Link to="/invite">Accept invite</Link>
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
