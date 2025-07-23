// src/components/SettingsModal.tsx (or similar component)
import React, { useEffect, useState } from 'react';
import {
  requestNotificationPermission,
  subscribeUserToPush,
  getNotificationPreference,
  setNotificationPreference,
  sendNotification // Your existing in-app notification function
} from '../utils/notifications'; // Adjust path if necessary

const NotificationSettings: React.FC = () => {
  const [permissionStatus, setPermissionStatus] = useState<NotificationPermission | 'unsupported'>('default');
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [auroraEnabled, setAuroraEnabled] = useState(getNotificationPreference('aurora-alert'));

  useEffect(() => {
    const checkStatus = async () => {
      const status = await requestNotificationPermission();
      setPermissionStatus(status);

      if (status === 'granted' && 'serviceWorker' in navigator && 'PushManager' in window) {
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.getSubscription();
        setIsSubscribed(!!subscription);
      }
    };
    checkStatus();
  }, []);

  const handleEnableNotifications = async () => {
    const permission = await requestNotificationPermission();
    if (permission === 'granted') {
      setPermissionStatus('granted');
      const subscription = await subscribeUserToPush(); // This is the crucial call!
      setIsSubscribed(!!subscription);
      alert('Notifications enabled and subscribed! (Check console for details)');
      sendNotification('Welcome!', 'You will now receive solar dashboard alerts.', { tag: 'welcome' }); // Example of your existing in-app notification
    } else {
      setPermissionStatus(permission);
      alert(`Permission ${permission}. Cannot enable notifications.`);
    }
  };

  const handleToggleAuroraAlert = (e: React.ChangeEvent<HTMLInputElement>) => {
    const enabled = e.target.checked;
    setAuroraEnabled(enabled);
    setNotificationPreference('aurora-alert', enabled);
    console.log(`Aurora alerts ${enabled ? 'enabled' : 'disabled'}.`);
    // Note: This preference is local. For server-sent pushes, your backend
    // would ideally also need to know user preferences for filtering.
  };

  return (
    <div>
      <h2>Notification Settings</h2>
      {permissionStatus === 'unsupported' && <p className="warning">Notifications are not supported by your browser.</p>}
      {permissionStatus === 'denied' && (
        <p className="warning">Notifications are blocked. Please enable them in your browser settings.</p>
      )}

      {(permissionStatus === 'default' || permissionStatus === 'granted') && (
        <div>
          <p>Current permission: <strong>{permissionStatus}</strong></p>
          {!isSubscribed && permissionStatus === 'granted' && (
            <button onClick={handleEnableNotifications}>
              Subscribe to Push Notifications
            </button>
          )}
          {isSubscribed && <p className="success">You are subscribed to push notifications!</p>}
          {permissionStatus === 'default' && (
             <button onClick={handleEnableNotifications}>
              Enable Notifications
             </button>
          )}
        </div>
      )}

      {/* Example for managing specific notification types (local preference) */}
      {isSubscribed && (
        <div>
          <h3>Alert Categories</h3>
          <label>
            <input
              type="checkbox"
              checked={auroraEnabled}
              onChange={handleToggleAuroraAlert}
            />
            Aurora Alerts (e.g., Kp-index high)
          </label>
          {/* Add more categories as needed */}
        </div>
      )}

      {/* For testing: Manually send an in-app notification */}
      <button onClick={() => sendNotification('Test Notification', 'This is an in-app test notification.', {tag: 'test-in-app'})}>
        Send In-App Test
      </button>

      {/* For testing: Manually trigger a push notification (for dev/testing only, not prod) */}
      {isSubscribed && (
         <button onClick={async () => {
            alert('Attempting to send push from worker. Check your device!');
            try {
                // This would hit your Cloudflare Worker's /api/send-notification endpoint
                // In a real app, this is triggered by your backend's solar monitoring logic
                const response = await fetch('https://solar-dashboard-push-worker.<YOUR_SUBDOMAIN>.workers.dev/api/send-notification', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        title: 'Test Push!',
                        body: 'This is a test notification from your Cloudflare Worker.',
                        tag: 'test-push',
                        url: '/solar-dashboard'
                    })
                });
                if (response.ok) {
                    console.log('Test push trigger successful.');
                } else {
                    const error = await response.text();
                    console.error('Test push trigger failed:', error);
                    alert('Failed to trigger push: ' + error);
                }
            } catch (err) {
                console.error('Error triggering test push:', err);
                alert('Error triggering push: ' + err.message);
            }
         }}>
             Trigger Test Push (Dev Only)
         </button>
      )}
    </div>
  );
};

export default NotificationSettings;