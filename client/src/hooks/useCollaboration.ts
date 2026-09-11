import { useEffect, useRef, useState } from 'react';
import axios from 'axios';

const API = '/api/collaboration';

export interface PresenceUser {
  user_job_no: string;
  user_name: string;
  latest_changes?: string[];
  last_change_at?: string | null;
  last_seen_at: string;
  is_editor?: boolean;
}

export function useCollaborationPresence({
  resourceType, resourceId, enabled, changes = [],
}: {
  resourceType: string; resourceId?: string | number | null; enabled: boolean; changes?: string[];
}) {
  const [users, setUsers] = useState<PresenceUser[]>([]);
  const [recentChanges, setRecentChanges] = useState<PresenceUser[]>([]);
  const changesRef = useRef(changes);
  const sentChangesRef = useRef('');
  changesRef.current = changes;

  useEffect(() => {
    if (!enabled || resourceId == null || resourceId === '') { setUsers([]); setRecentChanges([]); return; }
    let stopped = false;
    const heartbeat = async () => {
      const signature = JSON.stringify(changesRef.current);
      const nextChanges = signature !== sentChangesRef.current ? changesRef.current : [];
      try {
        const response = await axios.post(`${API}/presence`, {
          resource_type: resourceType, resource_id: String(resourceId), changes: nextChanges,
        });
        if (!stopped) setUsers(response.data?.users || []);
        if (!stopped) setRecentChanges(response.data?.recent_changes || []);
        if (nextChanges.length) sentChangesRef.current = signature;
      } catch { /* presence failure must never interrupt editing */ }
    };
    heartbeat();
    const timer = window.setInterval(heartbeat, 15_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      axios.delete(`${API}/presence`, { data: { resource_type: resourceType, resource_id: String(resourceId) } }).catch(() => {});
    };
  }, [enabled, resourceType, resourceId]);

  useEffect(() => {
    if (!enabled || resourceId == null || resourceId === '' || !changes.length) return;
    const timer = window.setTimeout(() => {
      axios.post(`${API}/presence`, {
        resource_type: resourceType, resource_id: String(resourceId), changes,
      }).then(response => {
        setUsers(response.data?.users || []);
        setRecentChanges(response.data?.recent_changes || []);
        sentChangesRef.current = JSON.stringify(changes);
      }).catch(() => {});
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [enabled, resourceType, resourceId, JSON.stringify(changes)]);

  return { users, recentChanges };
}

export function useExclusiveEditLease({
  resourceType, resourceId, enabled,
}: {
  resourceType: string; resourceId?: string | number | null; enabled: boolean;
}) {
  const [token, setToken] = useState<string | null>(null);
  const [holderName, setHolderName] = useState<string | null>(null);
  const [holderJobNo, setHolderJobNo] = useState<string | null>(null);
  const [pendingRequests, setPendingRequests] = useState<Array<{ id: number; requester_job_no: string; requester_name: string; requested_at: string }>>([]);
  const [myRequestStatus, setMyRequestStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled && resourceId != null);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  useEffect(() => {
    if (!enabled || resourceId == null || resourceId === '') {
      setToken(null); setHolderName(null); setHolderJobNo(null); setPendingRequests([]); setMyRequestStatus(null); setLoading(false); return;
    }
    let stopped = false;
    const refreshStatus = async () => {
      try {
        const response = await axios.get(`${API}/leases/status`, { params: { resource_type: resourceType, resource_id: String(resourceId) } });
        if (stopped) return;
        const held = response.data?.lease || null;
        const nextToken = held?.lease_token || null;
        const requestStatus = response.data?.my_request?.status || null;
        if (nextToken && !tokenRef.current && requestStatus === 'approved') {
          const markerKey = `edit_handoff:${resourceType}:${resourceId}`;
          if (window.sessionStorage.getItem(markerKey) !== nextToken) {
            window.sessionStorage.setItem(markerKey, nextToken);
            window.location.reload();
            return;
          }
          window.sessionStorage.removeItem(markerKey);
        }
        tokenRef.current = nextToken;
        setToken(nextToken);
        setHolderName(held?.holder_name || null);
        setHolderJobNo(held?.holder_job_no || null);
        setPendingRequests(response.data?.pending_requests || []);
        setMyRequestStatus(requestStatus);
      } catch {
        // 状态轮询失败不打断只读查看；已有令牌仍由心跳判断是否有效。
      } finally { if (!stopped) setLoading(false); }
    };
    setLoading(true);
    refreshStatus();

    const statusTimer = window.setInterval(refreshStatus, 5_000);
    const heartbeatTimer = window.setInterval(async () => {
      if (!tokenRef.current) return;
      try {
        await axios.post(`${API}/leases/heartbeat`, {
          resource_type: resourceType, resource_id: String(resourceId), lease_token: tokenRef.current,
        });
      } catch (error: any) {
        if (!stopped && error.response?.status === 423) {
          tokenRef.current = null;
          setToken(null); setHolderName(error.response?.data?.holder_name || null);
          refreshStatus();
        }
      }
    }, 25_000);
    return () => {
      stopped = true;
      window.clearInterval(statusTimer);
      window.clearInterval(heartbeatTimer);
      if (tokenRef.current) axios.delete(`${API}/leases`, { data: {
        resource_type: resourceType, resource_id: String(resourceId), lease_token: tokenRef.current,
      } }).catch(() => {});
    };
  }, [enabled, resourceType, resourceId]);

  const acquire = async () => {
    if (!enabled || resourceId == null || resourceId === '') return false;
    setLoading(true);
    try {
      const response = await axios.post(`${API}/leases/acquire`, { resource_type: resourceType, resource_id: String(resourceId) });
      const nextToken = response.data?.lease?.lease_token || null;
      tokenRef.current = nextToken;
      setToken(nextToken); setHolderName(response.data?.lease?.holder_name || null); setHolderJobNo(response.data?.lease?.holder_job_no || null);
      setMyRequestStatus(null);
      return !!nextToken;
    } catch (error: any) {
      setHolderName(error.response?.data?.lease?.holder_name || '其他用户');
      setHolderJobNo(error.response?.data?.lease?.holder_job_no || null);
      return false;
    } finally { setLoading(false); }
  };

  const requestEdit = async () => {
    if (!enabled || resourceId == null || resourceId === '') return false;
    try {
      await axios.post(`${API}/leases/request`, { resource_type: resourceType, resource_id: String(resourceId) });
      setMyRequestStatus('pending');
      return true;
    } catch (error: any) {
      if (error.response?.data?.code === 'lease_available') return acquire();
      throw error;
    }
  };

  const forceAcquire = async (reason: string) => {
    if (!enabled || resourceId == null || resourceId === '') return false;
    const response = await axios.post(`${API}/leases/force`, {
      resource_type: resourceType, resource_id: String(resourceId), reason,
    });
    const nextToken = response.data?.lease?.lease_token || null;
    tokenRef.current = nextToken; setToken(nextToken); setHolderName(response.data?.lease?.holder_name || null);
    return !!nextToken;
  };

  const release = async () => {
    if (!tokenRef.current || resourceId == null) return;
    const currentToken = tokenRef.current;
    await axios.delete(`${API}/leases`, { data: {
      resource_type: resourceType, resource_id: String(resourceId), lease_token: currentToken,
    } });
    tokenRef.current = null; setToken(null); setHolderName(null); setHolderJobNo(null); setPendingRequests([]);
  };

  const respond = async (requestId: number, action: 'approve' | 'reject') => {
    if (!tokenRef.current || resourceId == null) return false;
    await axios.post(`${API}/leases/respond`, {
      resource_type: resourceType, resource_id: String(resourceId), lease_token: tokenRef.current,
      request_id: requestId, action,
    });
    if (action === 'approve') { tokenRef.current = null; setToken(null); }
    setPendingRequests(previous => previous.filter(request => request.id !== requestId));
    return true;
  };

  return {
    acquired: !enabled || resourceId == null || resourceId === '' || !!token,
    token,
    holderName,
    holderJobNo,
    available: enabled && !loading && !holderName,
    pendingRequests,
    myRequestStatus,
    loading,
    headers: token ? { 'X-Edit-Lease-Token': token } : {},
    acquire, requestEdit, forceAcquire, release, respond,
  };
}
