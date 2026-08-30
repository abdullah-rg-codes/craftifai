import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { PageBody } from '../components/PageState.js';
import { pageErrorCopy } from '../errors.js';
import { useAuth } from '../auth.js';

interface Member {
  id: string;
  user_id: string;
  email: string;
  display_name: string | null;
  role: 'administrator' | 'member';
  status: 'active' | 'suspended';
}

interface MemberPage {
  members: Member[];
  next_cursor: string | null;
}

export function MembersPage() {
  const { session } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'administrator' | 'member'>('member');
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [invitedEmail, setInvitedEmail] = useState('');

  const load = useCallback(async (next: string | null, append: boolean) => {
    const query = new URLSearchParams({ limit: '20' });
    if (next) query.set('cursor', next);
    const page = await api<MemberPage>(`/members?${query.toString()}`);
    setMembers((current) => (append ? [...current, ...page.members] : page.members));
    setCursor(page.next_cursor);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    load(null, false)
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  async function invite(event: FormEvent) {
    event.preventDefault();
    setActionError(null);
    try {
      const created = await api<{ token: string }>('/members/invitations', {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      setInviteToken(created.token);
      setInvitedEmail(inviteEmail);
      setInviteEmail('');
    } catch (err) {
      setActionError(err);
    }
  }

  async function changeRole(member: Member, role: 'administrator' | 'member') {
    setActionError(null);
    try {
      await api(`/members/${member.id}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setMembers((current) =>
        current.map((row) => (row.id === member.id ? { ...row, role } : row)),
      );
    } catch (err) {
      setActionError(err);
    }
  }

  async function changeStatus(member: Member, status: 'active' | 'suspended') {
    setActionError(null);
    try {
      await api(`/members/${member.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setMembers((current) =>
        current.map((row) => (row.id === member.id ? { ...row, status } : row)),
      );
    } catch (err) {
      setActionError(err);
    }
  }

  async function remove(member: Member) {
    setActionError(null);
    try {
      await api(`/members/${member.id}`, { method: 'DELETE' });
      setMembers((current) => current.filter((row) => row.id !== member.id));
    } catch (err) {
      setActionError(err);
    }
  }

  return (
    <section>
      <h1>Team</h1>
      <form className="row-form" onSubmit={(event) => void invite(event)}>
        <label>
          Invite email
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            required
          />
        </label>
        <label>
          Role
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as 'administrator' | 'member')}
          >
            <option value="member">Member</option>
            <option value="administrator">Administrator</option>
          </select>
        </label>
        <button type="submit">Invite</button>
      </form>
      {inviteToken ? (
        <p className="notice">
          Invitation created. Give this one-time token to {invitedEmail} so they can accept it:{' '}
          <code>{inviteToken}</code>
        </p>
      ) : null}
      {actionError ? (
        <p className="error" role="alert">
          {pageErrorCopy(actionError)}
        </p>
      ) : null}
      <PageBody
        loading={loading}
        error={error}
        empty={{
          when: members.length === 0,
          title: 'No members yet',
          body: 'Invite someone with the form above. There is no email delivery; copy the token.',
        }}
      >
        <table>
          <thead>
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id}>
                <td>{member.email}</td>
                <td>{member.role}</td>
                <td>{member.status}</td>
                <td className="actions">
                  {member.role === 'member' ? (
                    <button type="button" onClick={() => void changeRole(member, 'administrator')}>
                      Promote
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={member.user_id === session?.user_id}
                      onClick={() => void changeRole(member, 'member')}
                    >
                      Demote
                    </button>
                  )}
                  {member.status === 'active' ? (
                    <button type="button" onClick={() => void changeStatus(member, 'suspended')}>
                      Suspend
                    </button>
                  ) : (
                    <button type="button" onClick={() => void changeStatus(member, 'active')}>
                      Reactivate
                    </button>
                  )}
                  <button type="button" onClick={() => void remove(member)}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {cursor ? (
          <button type="button" onClick={() => void load(cursor, true)}>
            Load more
          </button>
        ) : null}
      </PageBody>
    </section>
  );
}
