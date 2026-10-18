self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.includes("/dashboard/"));
    return existing ? existing.focus() : clients.openWindow("/dashboard/home");
  }));
});
