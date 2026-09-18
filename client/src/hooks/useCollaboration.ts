import { useEffect, useRef, useState } from 'react';
import axios from 'axios';
import { startSerialPolling } from '../utils/serialPolling';

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
  const key = JSON.stringify([enabled, resourceType, resourceId]);
  const [presence, setPresence] = useState<{ key: string; users: PresenceUser[]; recentChanges: PresenceUser[] }>({ key: '', users: [], recentChanges: [] });
  const changesRef = useRef(changes);
  const sendRef = useRef<(() => Promise<void>) | null>(null);
  changesRef.current = changes;

  useEffect(() => {
    if (!enabled || resourceId == null || resourceId === '') return;
    let stopped = false;
    let busy = false;
    let pending = false;
    let sentSignature = '';
    const controller = new AbortController();
    const heartbeat = async () => {
      if (stopped) return;
      if (busy) { pending = true; return; }
      busy = true;
      const signature = JSON.stringify(changesRef.current);
      const nextChanges = signature !== sentSignature ? changesRef.current : [];
      let succeeded = false;
      try {
        const response = await axios.post(`${API}/presence`, {
          resource_type: resourceType, resource_id: String(resourceId), changes: nextChanges,
        }, { signal: controller.signal, timeout: 10000 });
        if (stopped) return;
        setPresence({ key, users: Array.isArray(response.data?.users) ? response.data.users : [],
          recentChanges: Array.isArray(response.data?.recent_changes) ? response.data.recent_changes : [] });
        sentSignature = signature;
        succeeded = true;
      } catch { /* presence failure must never interrupt editing */ }
      finally {
        busy = false;
        const resend = pending && succeeded && JSON.stringify(changesRef.current) !== sentSignature;
        pending = false;
        if (!stopped && resend) void heartbeat();
      }
    };
    sendRef.current = heartbeat;
    const stopPolling = startSerialPolling(heartbeat, () => 15000 + Math.random() * 1000);
    return () => {
      stopped = true;
      controller.abort();
      stopPolling();
      if (sendRef.current === heartbeat) sendRef.current = null;
      axios.delete(`${API}/presence`, { data: { resource_type: resourceType, resource_id: String(resourceId) } }).catch(() => {});
    };
  }, [enabled, resourceType, resourceId, key]);

  useEffect(() => {
    if (!enabled || resourceId == null || resourceId === '' || !changes.length) return;
    const timer = window.setTimeout(() => {
      void sendRef.current?.();
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [enabled, resourceType, resourceId, JSON.stringify(changes)]);

  return presence.key === key ? { users: presence.users, recentChanges: presence.recentChanges } : { users: [], recentChanges: [] };
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
  // 状态轮询可能看到同账号其他标签页的令牌，不能在本页卸载时释放它。
  const acquiredHereRef = useRef<string | null>(null);
  // 用户点过“开始编辑”后，即使租约因服务重启、休眠或短暂断网丢失，也应在资源
  // 仍空闲时自动恢复。只有用户主动结束编辑或把编辑权交给别人时才清除此意图。
  const editingIntentRef = useRef(false);

  useEffect(() => {
    tokenRef.current = null;
    setToken(null);
    if (!enabled || resourceId == null || resourceId === '') {
      setToken(null); setHolderName(null); setHolderJobNo(null); setPendingRequests([]); setMyRequestStatus(null); setLoading(false); return;
    }
    let stopped = false;
    const controller = new AbortController();
    let statusBusy = false;
    let statusFailures = 0;
    let heartbeatBusy = false;
    // Sleep/background throttling can exceed the lease TTL. Renew only the exact
    // token we already own; the server rejects it after release or handoff.
    const renewToken = (leaseToken: string) => axios.post(`${API}/leases/heartbeat`, {
      resource_type: resourceType, resource_id: String(resourceId), lease_token: leaseToken,
    }, { signal: controller.signal, timeout: 10000 });
    const recoverToken = async (lostToken: string): Promise<'recovered' | 'occupied' | 'retry'> => {
      if (stopped || !editingIntentRef.current || tokenRef.current !== lostToken) return 'occupied';
      const acquiredByThisTab = acquiredHereRef.current === lostToken;
      try {
        const response = await axios.post(`${API}/leases/acquire`, {
          resource_type: resourceType, resource_id: String(resourceId),
        }, { signal: controller.signal, timeout: 10000 });
        if (stopped || tokenRef.current !== lostToken || !editingIntentRef.current) return 'retry';
        const nextToken = response.data?.lease?.lease_token || null;
        if (!nextToken) return 'retry';
        tokenRef.current = nextToken;
        // 同账号另一标签页的令牌可以继续使用，但本标签页不能因此获得“卸载时释放”资格。
        if (acquiredByThisTab) acquiredHereRef.current = nextToken;
        setToken(nextToken);
        setHolderName(response.data?.lease?.holder_name || null);
        setHolderJobNo(response.data?.lease?.holder_job_no || null);
        return 'recovered';
      } catch (error: any) {
        if (stopped || tokenRef.current !== lostToken) return 'retry';
        // 423 明确表示已被别人取得；普通网络错误不能作为丢失编辑权的证据。
        if (error.response?.status !== 423) return 'retry';
        setHolderName(error.response?.data?.lease?.holder_name || error.response?.data?.holder_name || '其他用户');
        setHolderJobNo(error.response?.data?.lease?.holder_job_no || null);
        return 'occupied';
      }
    };
    const refreshStatus = async () => {
      if (stopped || statusBusy) return;
      statusBusy = true;
      const requestedToken = tokenRef.current;
      try {
        const response = await axios.get(`${API}/leases/status`, { params: { resource_type: resourceType, resource_id: String(resourceId) }, signal: controller.signal, timeout: 10000 });
        if (stopped || tokenRef.current !== requestedToken) return;
        statusFailures = 0;
        const held = response.data?.lease || null;
        const nextToken = held?.lease_token || null;
        if (!nextToken && requestedToken) {
          try {
            await renewToken(requestedToken);
            // 状态快照可能来自租约续期前，或因身份信息短暂不同而隐藏令牌；
            // 只要原令牌仍有效，就不能把正在输入的页面切回只读。
            return;
          } catch (error: any) {
            if (stopped || tokenRef.current !== requestedToken) return;
            // A timeout is not proof that editing was handed off. Retry later.
            if (error.response?.status !== 423) return;
            const recovered = await recoverToken(requestedToken);
            if (recovered !== 'occupied') return;
          }
        }
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
        if (nextToken) editingIntentRef.current = true;
        setToken(nextToken);
        setHolderName(held?.holder_name || null);
        setHolderJobNo(held?.holder_job_no || null);
        setPendingRequests(response.data?.pending_requests || []);
        setMyRequestStatus(requestStatus);
      } catch {
        statusFailures = Math.min(statusFailures + 1, 3);
        // 状态轮询失败不打断只读查看；已有令牌仍由心跳判断是否有效。
      } finally { statusBusy = false; if (!stopped) setLoading(false); }
    };
    setLoading(true);
    const stopStatus = startSerialPolling(refreshStatus, () =>
      Math.max(document.hidden ? 15000 : 5000, 5000 * 2 ** statusFailures) + Math.random() * 1000);
    const onVisible = () => { if (!document.hidden) void refreshStatus(); };
    document.addEventListener('visibilitychange', onVisible);
    const heartbeatTimer = window.setInterval(async () => {
      if (stopped || heartbeatBusy || !tokenRef.current) return;
      heartbeatBusy = true;
      const heartbeatToken = tokenRef.current;
      try {
        await renewToken(heartbeatToken);
      } catch (error: any) {
        if (!stopped && tokenRef.current === heartbeatToken && error.response?.status === 423) {
          const recovered = await recoverToken(heartbeatToken);
          if (recovered === 'occupied' && tokenRef.current === heartbeatToken) {
            tokenRef.current = null;
            setToken(null);
            void refreshStatus();
          }
        }
      } finally { heartbeatBusy = false; }
    }, 25_000);
    return () => {
      stopped = true;
      stopStatus();
      controller.abort();
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(heartbeatTimer);
      if (tokenRef.current && acquiredHereRef.current === tokenRef.current) axios.delete(`${API}/leases`, { data: {
        resource_type: resourceType, resource_id: String(resourceId), lease_token: tokenRef.current,
      } }).catch(() => {});
      tokenRef.current = null;
      acquiredHereRef.current = null;
    };
  }, [enabled, resourceType, resourceId]);

  const acquire = async () => {
    if (!enabled || resourceId == null || resourceId === '') return false;
    setLoading(true);
    try {
      const response = await axios.post(`${API}/leases/acquire`, { resource_type: resourceType, resource_id: String(resourceId) });
      const nextToken = response.data?.lease?.lease_token || null;
      tokenRef.current = nextToken;
      acquiredHereRef.current = nextToken;
      editingIntentRef.current = !!nextToken;
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
    acquiredHereRef.current = nextToken;
    editingIntentRef.current = !!nextToken;
    tokenRef.current = nextToken; setToken(nextToken); setHolderName(response.data?.lease?.holder_name || null);
    return !!nextToken;
  };

  const release = async () => {
    if (!tokenRef.current || resourceId == null) return;
    const currentToken = tokenRef.current;
    await axios.delete(`${API}/leases`, { data: {
      resource_type: resourceType, resource_id: String(resourceId), lease_token: currentToken,
    } });
    editingIntentRef.current = false;
    acquiredHereRef.current = null;
    tokenRef.current = null; setToken(null); setHolderName(null); setHolderJobNo(null); setPendingRequests([]);
  };

  const respond = async (requestId: number, action: 'approve' | 'reject') => {
    if (!tokenRef.current || resourceId == null) return false;
    await axios.post(`${API}/leases/respond`, {
      resource_type: resourceType, resource_id: String(resourceId), lease_token: tokenRef.current,
      request_id: requestId, action,
    });
    if (action === 'approve') {
      editingIntentRef.current = false;
      acquiredHereRef.current = null;
      tokenRef.current = null;
      setToken(null);
    }
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
