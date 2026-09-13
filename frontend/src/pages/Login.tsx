import React, { useState, useEffect, useRef } from 'react';
import { Form, Input, Button, Card, Typography, Alert, Divider, Space, message, Progress, Statistic } from 'antd';
import { UserOutlined, LockOutlined, SafetyOutlined, InfoCircleOutlined, WarningOutlined, ClockCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

const { Title, Text } = Typography;

const LAST_ATTEMPT_KEY = 'lastLoginAttempt';
// Per-account lockout state, mirrored from the login response so a refresh
// keeps the countdown. (Was 'loginAttemptInfoGlobal' back when one shared
// counter locked every account at once.)
const ATTEMPT_INFO_KEY = 'loginAttemptInfo';
const DEFAULT_CREDENTIALS = { username: 'admin.system', password: 'Password123!' };
const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MIN = 10;

function getInitialValues() {
  try {
    const saved = localStorage.getItem(LAST_ATTEMPT_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.username) return parsed;
    }
  } catch {}
  return DEFAULT_CREDENTIALS;
}

interface AttemptInfo {
  failedAttempts: number;
  remainingAttempts: number;
  maxAttempts: number;
  lockedUntil?: string;
  remainingSeconds?: number;
  isLocked?: boolean;
  /** 'account' = this username is locked, 'ip' = this device is throttled. */
  lockScope?: 'account' | 'ip';
  /** Kept for backwards compatibility with older persisted payloads. */
  isGlobal?: boolean;
}

export const Login: React.FC = () => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [genericError, setGenericError] = useState<string | null>(null);
  const [attemptInfo, setAttemptInfo] = useState<AttemptInfo | null>(() => {
    try {
      const saved = localStorage.getItem(ATTEMPT_INFO_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [lockCountdown, setLockCountdown] = useState<number>(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [lastAttempt, setLastAttempt] = useState<{ username: string; password: string } | null>(() => {
    try {
      const saved = localStorage.getItem(LAST_ATTEMPT_KEY);
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const { login } = useAuth();
  const navigate = useNavigate();

  const isLocked = lockCountdown > 0 || attemptInfo?.isLocked;

  // Restore the last attempt and any per-account lockout countdown.
  // NOTE: we deliberately do NOT poll /auth/attempts here - that endpoint is
  // now admin-only, so an unauthenticated login page would just collect 401s.
  // The authoritative counters arrive in the 401/423 response of a login
  // attempt; persisting them keeps the countdown across a refresh.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LAST_ATTEMPT_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed.username) {
          form.setFieldsValue(parsed);
          setLastAttempt(parsed);
        }
      }
    } catch {}

    try {
      const localSaved = localStorage.getItem(ATTEMPT_INFO_KEY);
      if (!localSaved) return;
      const parsed: AttemptInfo = JSON.parse(localSaved);
      if (parsed.lockedUntil) {
        const remaining = Math.max(
          0,
          Math.ceil((new Date(parsed.lockedUntil).getTime() - Date.now()) / 1000),
        );
        if (remaining > 0) {
          setAttemptInfo(parsed);
          setLockCountdown(remaining);
          startCountdown(remaining);
        } else {
          localStorage.removeItem(ATTEMPT_INFO_KEY);
          setAttemptInfo(null);
        }
      } else if (parsed.failedAttempts) {
        setAttemptInfo(parsed);
      }
    } catch {}
  }, [form]);

  const startCountdown = (seconds: number) => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setLockCountdown(seconds);
    countdownRef.current = setInterval(() => {
      setLockCountdown(prev => {
        if (prev <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          localStorage.removeItem(ATTEMPT_INFO_KEY);
          setAttemptInfo(null);
          setGenericError(null);
          message.success('Lock expired - you can try again now');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const persistAttempt = (values: { username: string; password: string }) => {
    try {
      localStorage.setItem(LAST_ATTEMPT_KEY, JSON.stringify(values));
    } catch {}
  };

  const persistAttemptInfo = (info: AttemptInfo | null) => {
    try {
      if (info) {
        localStorage.setItem(ATTEMPT_INFO_KEY, JSON.stringify(info));
      } else {
        localStorage.removeItem(ATTEMPT_INFO_KEY);
      }
    } catch {}
  };

  const onValuesChange = (_changed: any, allValues: { username: string; password: string }) => {
    persistAttempt(allValues);
    if (_changed.username !== undefined) {
      form.setFields([{ name: 'username', errors: [] }]);
    }
    if (_changed.password !== undefined) {
      form.setFields([{ name: 'password', errors: [] }]);
    }
    if (genericError && !isLocked) setGenericError(null);
  };

  const onFinish = async (values: { username: string; password: string }) => {
    if (lockCountdown > 0) {
      message.error(
        `Account locked - wait ${Math.ceil(lockCountdown / 60)} min (${lockCountdown}s) before trying again`,
      );
      return;
    }

    setLoading(true);
    setGenericError(null);
    form.setFields([
      { name: 'username', errors: [] },
      { name: 'password', errors: [] },
    ]);
    persistAttempt(values);
    setLastAttempt({ ...values });
    
    try {
      await login(values.username, values.password);
      message.success(`Welcome ${values.username}!`);
      // Successful login clears this account's counter (the backend already did
      // it). We no longer call POST /auth/reset-attempts: that is an admin-only
      // endpoint now, and the login page has no business clearing every
      // account's counters.
      setAttemptInfo(null);
      persistAttemptInfo(null);
      setLockCountdown(0);
      if (countdownRef.current) clearInterval(countdownRef.current);
      navigate('/dashboard');
    } catch (err: any) {
      console.error('Login error:', err, err.response?.data);
      
      const errorCode = err.response?.data?.errorCode || '';
      const details = err.response?.data?.details || {};
      let rawMessage = err.response?.data?.message || err.response?.data?.error || err.message || 'Login failed';
      if (Array.isArray(rawMessage)) rawMessage = rawMessage.join(', ');
      
      const lowerMsg = String(rawMessage).toLowerCase();
      const isUserNotFound = errorCode === 'USER_NOT_FOUND' || lowerMsg.includes('not found');
      const isInvalidPassword = errorCode === 'INVALID_PASSWORD' || lowerMsg.includes('incorrect password');
      const isLockedErr = errorCode === 'ACCOUNT_LOCKED' || err.response?.status === 423 || lowerMsg.includes('locked');

      // Per-account counter (unknown usernames are throttled per device IP).
      let failedAttempts = details.failedAttempts ?? details.perUserAttempts ?? 0;
      if (failedAttempts === 0) {
        // Fallback: previous persisted count for this account, +1 for this try.
        failedAttempts = (attemptInfo?.failedAttempts || 0) + 1;
      }
      const maxAttempts = details.maxAttempts || MAX_ATTEMPTS;
      const remainingAttempts =
        details.remainingAttempts ?? Math.max(0, maxAttempts - failedAttempts);
      const lockedUntil = details.lockedUntil;
      const remainingSeconds = details.remainingSeconds || details.retryAfter || 0;
      const lockScope: 'account' | 'ip' = details.lockScope === 'ip' ? 'ip' : 'account';
      const nowLocked = isLockedErr || remainingAttempts === 0;

      const newAttemptInfo: AttemptInfo = {
        failedAttempts,
        remainingAttempts,
        maxAttempts,
        lockedUntil,
        remainingSeconds,
        isLocked: nowLocked,
        lockScope,
        isGlobal: false,
      };

      setAttemptInfo(newAttemptInfo);
      persistAttemptInfo(newAttemptInfo);

      if (nowLocked) {
        const secs = remainingSeconds || LOCK_DURATION_MIN * 60;
        setLockCountdown(secs);
        startCountdown(secs);
        const mins = Math.ceil(secs / 60);
        const scopeText =
          lockScope === 'ip'
            ? 'Too many attempts from this device'
            : `This account is locked after ${failedAttempts}/${maxAttempts} failed attempts`;
        const friendly = `${scopeText}. Wait ${mins} min (${secs}s)${
          lockedUntil ? ` until ${new Date(lockedUntil).toLocaleTimeString()}` : ''
        }. Other accounts are not affected.`;
        setGenericError(friendly);
        message.error(friendly, 6);
      } else if (isUserNotFound) {
        // Inline error under the username field; the other field is preserved.
        const msg = `Username "${values.username}" not found. ${remainingAttempts} attempt${
          remainingAttempts === 1 ? '' : 's'
        } left before a ${LOCK_DURATION_MIN}-minute lock on this device.`;
        form.setFields([{ name: 'username', errors: [msg] }]);
        message.warning(msg, 4);
      } else if (isInvalidPassword) {
        const msg = `Incorrect password. Attempt ${failedAttempts}/${maxAttempts} - ${remainingAttempts} left before this account locks for ${LOCK_DURATION_MIN} min.`;
        form.setFields([{ name: 'password', errors: [msg] }]);
        message.warning(msg, 4);
      } else {
        if (lowerMsg.includes('password')) {
          form.setFields([{ name: 'password', errors: [String(rawMessage)] }]);
        } else if (lowerMsg.includes('username') || lowerMsg.includes('user')) {
          form.setFields([{ name: 'username', errors: [String(rawMessage)] }]);
        } else {
          setGenericError(String(rawMessage));
          message.error(String(rawMessage), 5);
        }
      }

      form.setFieldsValue(values);
      persistAttempt(values);
      setLastAttempt({ ...values });
    } finally {
      setLoading(false);
    }
  };

  const fillDemoAccount = (username: string) => {
    if (isLocked) {
      message.warning(`Locked - wait ${Math.ceil(lockCountdown / 60)} min, or clear the countdown below`);
      return;
    }
    const newValues = { username, password: 'Password123!' };
    form.setFieldsValue(newValues);
    form.setFields([
      { name: 'username', errors: [] },
      { name: 'password', errors: [] },
    ]);
    persistAttempt(newValues);
    setLastAttempt(newValues);
    setGenericError(null);
  };

  /**
   * Clear the locally remembered attempt/lockout state and restore the demo
   * credentials. This no longer calls POST /auth/reset-attempts: that endpoint
   * is admin-only (it clears counters for every account), so an unauthenticated
   * login page must not invoke it - a real unlock is an admin action in
   * Administration -> User Management.
   */
  const clearAndResetDefault = () => {
    localStorage.removeItem(LAST_ATTEMPT_KEY);
    localStorage.removeItem(ATTEMPT_INFO_KEY);
    form.setFieldsValue(DEFAULT_CREDENTIALS);
    form.setFields([
      { name: 'username', errors: [] },
      { name: 'password', errors: [] },
    ]);
    setLastAttempt(DEFAULT_CREDENTIALS);
    setAttemptInfo(null);
    setLockCountdown(0);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setGenericError(null);
    message.success('Form reset to admin.system');
  };

  /** Dismiss the local countdown display only - the server-side lock stands. */
  const clearLockoutDisplay = () => {
    localStorage.removeItem(ATTEMPT_INFO_KEY);
    setAttemptInfo(null);
    setLockCountdown(0);
    if (countdownRef.current) clearInterval(countdownRef.current);
    setGenericError(null);
    form.setFields([
      { name: 'username', errors: [] },
      { name: 'password', errors: [] },
    ]);
    message.info('Countdown hidden. The account stays locked on the server until it expires.');
  };

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const attemptPercent = attemptInfo
    ? Math.min(100, (attemptInfo.failedAttempts / (attemptInfo.maxAttempts || MAX_ATTEMPTS)) * 100)
    : 0;

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        padding: 24,
      }}
    >
      <Card
        style={{
          width: 480,
          boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
          borderRadius: 16,
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 12 }}>
          <SafetyOutlined style={{ fontSize: 38, color: '#1677ff', marginBottom: 6 }} />
          <Title level={4} style={{ marginBottom: 2 }}>
            Nurse-App
          </Title>
          <Text type="secondary" style={{ fontSize: 11 }}>
            <SafetyOutlined /> {MAX_ATTEMPTS} failed attempts → {LOCK_DURATION_MIN}-minute lock, per account
          </Text>
          <div style={{ marginTop: 6, display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
            {lastAttempt && (
              <span style={{ fontSize: 10, color: '#1677ff', background: '#f0f5ff', padding: '2px 8px', borderRadius: 10 }}>
                <InfoCircleOutlined style={{ marginRight: 3 }} />
                Last: {lastAttempt.username}
              </span>
            )}
            {attemptInfo && (
              <span style={{ fontSize: 10, color: isLocked ? '#ff4d4f' : '#faad14', background: isLocked ? '#fff2f0' : '#fffbe6', padding: '2px 8px', borderRadius: 10, border: `1px solid ${isLocked ? '#ffccc7' : '#ffe58f'}` }}>
                <WarningOutlined style={{ marginRight: 3 }} />
                {attemptInfo.lockScope === 'ip' ? 'This device' : 'This account'}: {attemptInfo.failedAttempts}/{attemptInfo.maxAttempts || MAX_ATTEMPTS} {isLocked ? 'LOCKED' : `(${attemptInfo.remainingAttempts} left)`}
              </span>
            )}
          </div>
        </div>

        {attemptInfo && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: isLocked ? '#fff2f0' : attemptInfo.failedAttempts >= 3 ? '#fffbe6' : '#f6ffed', border: `1px solid ${isLocked ? '#ffccc7' : attemptInfo.failedAttempts >= 3 ? '#ffe58f' : '#b7eb8f'}`, borderRadius: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <Text strong style={{ fontSize: 11 }}>
                <WarningOutlined style={{ marginRight: 4, color: isLocked ? '#ff4d4f' : '#faad14' }} />
                Failed attempts: {attemptInfo.failedAttempts}/{attemptInfo.maxAttempts || MAX_ATTEMPTS}
              </Text>
              <Text type="secondary" style={{ fontSize: 10 }}>
                {isLocked ? 'LOCKED' : `${attemptInfo.remainingAttempts} left`}
              </Text>
            </div>
            <Progress percent={attemptPercent} showInfo={false} size="small" strokeColor={isLocked ? '#ff4d4f' : attemptInfo.failedAttempts >= 3 ? '#faad14' : '#52c41a'} style={{ margin: 0 }} />
            <div style={{ fontSize: 10, color: '#666', marginTop: 4, display: 'flex', justifyContent: 'space-between' }}>
              <span>Failed: {attemptInfo.failedAttempts} | Remaining: {attemptInfo.remainingAttempts}</span>
              {isLocked
                ? <span style={{ color: '#ff4d4f', fontWeight: 'bold' }}><ClockCircleOutlined /> Locked {LOCK_DURATION_MIN} min</span>
                : <span>Only this account is affected</span>}
            </div>
            {isLocked && lockCountdown > 0 && (
              <div style={{ marginTop: 8, textAlign: 'center', background: '#fff', padding: 8, borderRadius: 6, border: '1px dashed #ff4d4f' }}>
                <Statistic title="Unlock in" value={formatCountdown(lockCountdown)} prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: 22, color: '#ff4d4f', fontWeight: 'bold' }} />
                <Text type="secondary" style={{ fontSize: 10 }}>
                  Wait {Math.ceil(lockCountdown / 60)} min ({lockCountdown}s), or ask an administrator to unlock the account.
                </Text>
                <br />
                <Button size="small" icon={<ReloadOutlined />} onClick={clearLockoutDisplay} style={{ marginTop: 6, fontSize: 10 }}>
                  Hide countdown
                </Button>
              </div>
            )}
          </div>
        )}

        {genericError && (
          <Alert
            message={isLocked ? `Locked - wait ${LOCK_DURATION_MIN} min` : "Authentication Issue"}
            description={<div style={{ whiteSpace: 'pre-line', fontSize: 11 }}>{genericError}</div>}
            type={isLocked ? "error" : "warning"}
            showIcon
            closable
            onClose={() => setGenericError(null)}
            style={{ marginBottom: 12, fontSize: 11 }}
          />
        )}

        <Form
          form={form}
          name="login"
          onFinish={onFinish}
          onValuesChange={onValuesChange}
          layout="vertical"
          size="large"
          preserve={true}
          initialValues={getInitialValues()}
          style={{ marginBottom: 0 }}
        >
          <Form.Item
            name="username"
            rules={[{ required: true, message: 'Please input your username!' }]}
            style={{ marginBottom: 14 }}
            hasFeedback
          >
            <Input prefix={<UserOutlined />} placeholder="Username or Email" allowClear disabled={isLocked} />
          </Form.Item>

          <Form.Item
            name="password"
            rules={[{ required: true, message: 'Please input your password!' }]}
            style={{ marginBottom: 14 }}
            hasFeedback
          >
            <Input.Password prefix={<LockOutlined />} placeholder="Password" allowClear disabled={isLocked} />
          </Form.Item>

          <Form.Item style={{ marginBottom: 8 }}>
            <Button type="primary" htmlType="submit" loading={loading} block disabled={isLocked}>
              {isLocked ? `Locked - wait ${formatCountdown(lockCountdown)}` : 'Log in'}
            </Button>
          </Form.Item>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 0 }}>
            <Button type="link" size="small" onClick={clearAndResetDefault} style={{ fontSize: 10, padding: 0 }}>
              Reset form
            </Button>
            <Text type="secondary" style={{ fontSize: 10 }}>
              {attemptInfo
                ? `Attempts: ${attemptInfo.failedAttempts}/${attemptInfo.maxAttempts || MAX_ATTEMPTS}`
                : `${MAX_ATTEMPTS} attempts → ${LOCK_DURATION_MIN} min lock (per account)`}
            </Text>
          </div>
        </Form>

        <Divider style={{ margin: '10px 0' }}>Demo Accounts</Divider>

        <Space direction="vertical" size={2} style={{ width: '100%', fontSize: 11 }}>
          <Text type="secondary" style={{ fontSize: 10 }}>
            Password: <Text code style={{ fontSize: 10 }}>Password123!</Text> — click an account to fill the form
          </Text>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2, fontSize: 10 }}>
            {['admin.system','susan.lee','james.wilson','maria.garcia','rachel.brown','patricia.johnson','ahmed.hassan','michael.wong'].map(u => (
              <Button key={u} type="link" size="small" style={{ textAlign: 'left', padding: '0 4px', height: 18, fontSize: 10 }} onClick={() => fillDemoAccount(u)} disabled={!!isLocked}>
                • {u} {u.includes('admin') ? '(ADMIN)' : ''}
              </Button>
            ))}
          </div>
          <div style={{ fontSize: 9, color: '#595959', background: '#fafafa', padding: '6px', borderRadius: 4, border: '1px solid #f0f0f0' }}>
            <strong>Per-account lockout:</strong> {MAX_ATTEMPTS} wrong passwords lock <em>that account only</em> for {LOCK_DURATION_MIN} minutes; everyone else can still sign in.
            <br/>Unknown usernames are throttled per device instead, so a typo can never lock the whole hospital out.
          </div>
        </Space>

        <div style={{ marginTop: 8, textAlign: 'center' }}>
          <Text type="secondary" style={{ fontSize: 9 }}>
            {MAX_ATTEMPTS} attempts / {LOCK_DURATION_MIN} min lock — per account, not global
          </Text>
        </div>
      </Card>
    </div>
  );
};
