# WBPAI collector setup

Use one always-on collector device per building.

## Processes to run

From `backend/`, run:

```sh
npm run start:collectors
```

That starts and restarts:

- `server.js` for backend routes and external temperature writes
- `weather-handler.js` for per-building external temperature writes
- `mqtt-handler.js` for CAD / smart meter MQTT energy readings
- `glow-api-handler.js` for Glow API energy polling when cloud MQTT is quiet
- `milesight-handler.js` for future home Milesight IAQ API polling
- `thingsboard-handler.js` for ThingsBoard IAQ readings

Set `COLLECTOR_PROCESSES` in `backend/.env` to run only the collectors needed
on a specific device:

```env
COLLECTOR_PROCESSES=mqtt,glow-api
```

Recommended device roles:

- House tablet now: `COLLECTOR_PROCESSES=mqtt,glow-api`
- House tablet later with Milesight IAQ API: `COLLECTOR_PROCESSES=mqtt,glow-api,milesight`
- Any always-on collector that should write weather: include `weather`
- Museum IAQ tablet: `BUILDING_ID=museum` and `COLLECTOR_PROCESSES=thingsboard`

Do not include `thingsboard` on the house tablet. That collector is the museum
ThingsBoard/dashboard workaround. Do not include `milesight` until the home
Milesight API credentials and endpoint are configured.

## Termux tablet auto-update

On an Android tablet running Termux, use the repo script so the tablet keeps
pulling GitHub and restarts the collectors when `main` changes:

```sh
pkg update -y
pkg install -y git nodejs tmux
cd ~
git clone https://github.com/SMOLYNEUX78/WBPAI.git
cd WBPAI
chmod +x scripts/termux-auto-update.sh scripts/termux-start.sh
cd backend
npm install
```

Create `backend/.env` locally on the tablet. The easiest way in Termux is to
paste the whole file in one go:

```sh
cat > .env
```

Paste the environment values, then press `Ctrl+D` on a hardware keyboard. If
using the on-screen keyboard, Termux's extra key row usually has `CTRL`; tap
`CTRL`, then tap `D`.

Then start the auto-updater:

```sh
cd ~/WBPAI
./scripts/termux-start.sh
```

To configure the house tablet after the repo is already cloned and `backend/.env`
already contains Supabase and Glow credentials:

```sh
cd ~/WBPAI
git pull origin main
sh scripts/termux-config-home-tablet.sh
```

That sets the tablet to `COLLECTOR_INSTANCE=home-tablet` and limits Glow API
polling to the home electricity and gas resources.

The collectors keep running inside a `tmux` session. To inspect them later:

```sh
tmux attach -t wbpai
```

Detach without stopping them by pressing `Ctrl+B`, then `D`.

## Per-building environment

Each collector needs its own `backend/.env`.

Museum:

```env
BUILDING_ID=museum
COLLECTOR_INSTANCE=museum-tablet
MQTT_URL=mqtt://localhost
MQTT_TOPIC=glow/#
MQTT_USERNAME=
MQTT_PASSWORD=
DEFAULT_LAT=52.0901
DEFAULT_LON=-1.3210
```

Home:

```env
BUILDING_ID=home
COLLECTOR_INSTANCE=home-tablet
COLLECTOR_PROCESSES=mqtt,glow-api
MQTT_URL=mqtt://localhost
MQTT_TOPIC=glow/#
MQTT_USERNAME=
MQTT_PASSWORD=
DEFAULT_LAT=your-home-latitude
DEFAULT_LON=your-home-longitude
```

Future home Milesight IAQ:

```env
BUILDING_ID=home
COLLECTOR_INSTANCE=home-tablet
COLLECTOR_PROCESSES=mqtt,glow-api,milesight
MILESIGHT_API_BASE_URL=
MILESIGHT_USERNAME=
MILESIGHT_PASSWORD=
MILESIGHT_API_TOKEN=
MILESIGHT_POLL_INTERVAL_MS=60000
```

## Per-building external temperature

Do not rely on a single `DEFAULT_LAT` / `DEFAULT_LON` once the dashboard has
more than one building. Use `weather-handler.js` with an explicit building map:

```env
COLLECTOR_PROCESSES=weather,mqtt,glow-api
WEATHER_POLL_INTERVAL_MS=300000
WEATHER_LOCATIONS=museum:52.0901:-1.3210,home:your-home-latitude:your-home-longitude
```

Later, once the Matterport SDK/API integration is complete, the Matterport model
coordinates can be used to populate or update this building coordinate map.

If the tablet connects directly to Glow/Bright MQTT instead of a local CAD /
Mosquitto broker, use:

```env
MQTT_URL=mqtts://glowmqtt.energyhive.com:8883
MQTT_TOPIC=SMART/HILD/<cad-or-ihd-device-id>
MQTT_TOPIC_BUILDING_MAP=SMART/HILD/<cad-or-ihd-device-id>=home
MQTT_PROTOCOL_VERSION=4
MQTT_USERNAME=your-bright-username
MQTT_PASSWORD=your-bright-password
```

For Glow cloud MQTT, `device/#` can connect but fail to subscribe. The usual
topic shape is `SMART/HILD/<device-id>` with no trailing slash.

If one Glow account contains multiple buildings, subscribe to both topics and
map each one to the building that should be written to Supabase:

```env
MQTT_TOPIC=SMART/HILD/E0E2E62C5584,SMART/HILD/BCDDC2C52AA0
MQTT_TOPIC_BUILDING_MAP=SMART/HILD/E0E2E62C5584=home,SMART/HILD/BCDDC2C52AA0=museum
```

Keep real Supabase, OpenWeather and ThingsBoard values in `.env` only.

## Glow API fallback

Glow cloud MQTT can accept subscriptions but still remain quiet. The API
collector polls resource IDs directly and writes electricity/gas rows into
`EnergyReadings`.

```env
GLOW_API_POLL_INTERVAL_MS=60000
GLOW_API_RESOURCES=home:electricity:042517ae-601f-4928-b3d2-e49b1de0e695,home:gas:a2130979-fb09-48bf-89f9-5703c30037b8,museum:electricity:12e31e6d-11dc-4bc3-a70b-dab6f76fc73c
```

## Supabase requirement

The shared architecture expects `Readings` to include a nullable text column:

```sql
alter table "Readings"
add column if not exists building_id text;
```

Existing museum rows can remain blank while the current dashboard keeps using
legacy unscoped museum data. New collectors should write `museum` or `home`.

If `DailyEnergyTotals` is a view, update it to include or group by `building_id`
before relying on home energy averages.
