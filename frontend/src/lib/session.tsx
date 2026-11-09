"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { ApiError, type EndpointResponse } from '@enterprise/contracts';
import { identityApi } from '@/api/identity';
import { cancelSessionRequests } from '@/api/http';
import { authApi } from '@/api/auth';
import { App } from "antd";
import { useQueryClient } from '@tanstack/react-query';
export type EnterpriseMe = NonNullable<EndpointResponse<'Identity_me'>['data']>;

type SessionValue = {
  me: EnterpriseMe | null;
  loading: boolean;
  switchingIdentity: boolean;
  refresh: () => Promise<void>;
  switchIdentity: (identity: string) => Promise<void>;
  logout: () => void;
  sessionChanged: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

/** 无需已有会话的公开路径：这些页面拿到 401 时不能把人踢回登录页。 */
const SESSION_FREE_PATHS = ['/', '/login'];
/** 访客公开通道（官网客服 iframe）不参与登录态。 */
const SESSION_FREE_PREFIXES = ['/embed/', '/survey/'];
const sessionFree = (path = window.location.pathname) =>
  SESSION_FREE_PATHS.includes(path) ||
  SESSION_FREE_PREFIXES.some((prefix) => path.startsWith(prefix));

export function SessionProvider({ children }: { children: ReactNode }) {
  const client=useQueryClient();
  const {message}=App.useApp();
  const generation=useRef(0);
  const channel=useRef<BroadcastChannel|null>(null);
  const [me, setMe] = useState<EnterpriseMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [switchingIdentity, setSwitchingIdentity] = useState(false);
  const switchInFlight = useRef(false);

  const refresh = useCallback(async () => {
    const current=++generation.current;
    setLoading(true);
    try {
      const payload=await identityApi.me();
      if(current!==generation.current)return;
      setMe(payload); setLoading(false);
      const scope=JSON.stringify([payload?.userId,payload?.currentIdentity]);
      try {
        const previous=window.sessionStorage.getItem('enterprise-session-scope');
        window.sessionStorage.setItem('enterprise-session-scope',scope);
        if(previous&&previous!==scope)channel.current?.postMessage({event:'changed'});
      } catch { /* 会话仍可在禁止存储的浏览器中使用。 */ }
    } catch(error) {
      if(current!==generation.current)return;
      setMe(null);setLoading(false);
      if(error instanceof ApiError&&error.status===401&&!sessionFree()){
        const next=window.location.pathname+window.location.search;
        window.location.assign('/login?next='+encodeURIComponent(next));
      }else if(!(error instanceof ApiError&&error.status===401))throw error;
    }
  }, []);
  const clearPrivate=useCallback(async()=>{
    generation.current++;setMe(null);setLoading(true);cancelSessionRequests();
    await client.cancelQueries();client.clear();
  },[client]);
  useEffect(()=>{
    void refresh().catch(()=>setLoading(false));
    const connection=new BroadcastChannel('enterprise-session'); channel.current=connection;
    connection.onmessage=()=>{void clearPrivate().then(refresh).catch(()=>setLoading(false));};
    const expired=()=>{if(sessionFree())return;void clearPrivate().then(()=>{window.location.assign('/login?reason=expired&next='+encodeURIComponent(window.location.pathname+window.location.search));});};
    window.addEventListener('enterprise-session-expired',expired);
    // 这个自增计数用于作废在途响应，只在清理函数里读，不需要作为依赖触发重订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return ()=>{generation.current++;connection.close();channel.current=null;window.removeEventListener('enterprise-session-expired',expired);};
  },[refresh,clearPrivate]);
  const switchIdentity=useCallback(async(identity:string)=>{
    if(switchInFlight.current)throw new Error('正在切换身份，请稍候');
    switchInFlight.current=true;setSwitchingIdentity(true);
    try{
      await clearPrivate();
      await identityApi.switchIdentity({body:{identity}});
      channel.current?.postMessage({event:'changed'});
      await refresh();
    }catch(error){setMe(null);setLoading(false);throw error;}
    finally{switchInFlight.current=false;setSwitchingIdentity(false);}
  },[clearPrivate,refresh]);
  const logout=useCallback(()=>{
    void clearPrivate().then(()=>authApi.logout()).then(()=>{
      channel.current?.postMessage({event:'changed'});window.location.assign('/login');
    }).catch((error:unknown)=>{setLoading(false);void message.error(error instanceof Error?error.message:'退出失败，请重试');});
  },[clearPrivate,message]);

  const sessionChanged=useCallback(async()=>{await clearPrivate();channel.current?.postMessage({event:'changed'});},[clearPrivate]);

  const value = useMemo(
    () => ({ me, loading, switchingIdentity, refresh, switchIdentity, logout, sessionChanged }),
    [me, loading, switchingIdentity, refresh, switchIdentity, logout, sessionChanged],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return value;
}
