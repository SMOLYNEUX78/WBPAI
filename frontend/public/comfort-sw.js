self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const key = event.notification.data?.key || "";
  const target = event.notification.data?.type === "heating"
    ? "/dashboard/home?heating=1"
    : `/dashboard/home?comfort=${encodeURIComponent(key)}`;
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const existing = windows.find((windowClient) => windowClient.url.includes("/dashboard/"));
    return existing ? existing.navigate(target).then((client) => client.focus()) : clients.openWindow(target);
  }));
});
