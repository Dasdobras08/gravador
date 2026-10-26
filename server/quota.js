// Saldo de minutos (funções SQL my_quota / consume_seconds). Só existe no modo serviço (Supabase).
export function createQuota(sb) {
  return {
    /** Saldo do usuário do token (via my_quota, que usa auth.uid()). */
    mine: (token) => sb.rpc({ token }, 'my_quota'),
    /** Debita segundos (idempotente por reunião). Usa a chave de serviço. */
    consume: (userId, seconds, meetingId) =>
      sb.rpc('service', 'consume_seconds', { p_user: userId, p_seconds: Math.ceil(seconds), p_meeting: meetingId }),
  };
}
