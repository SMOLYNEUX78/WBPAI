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
- `dyson-handler.js` for home Dyson purifier IAQ polling over local MQTT
- `thingsboard-handler.js` for ThingsBoard IAQ readings

Set `COLLECTOR_PROCESSES` in `backend/.env` to run only the collectors needed
on a specific device:

```env
COLLECTOR_PROCESSES=mqtt,glow-api
```

Recommended device roles:

- House tablet now: `COLLECTOR_PROCESSES=glow-api`
- House tablet with Dyson purifier IAQ: `COLLECTOR_PROCESSES=glow-api,dyson`
- House tablet later with Milesight IAQ API: `COLLECTOR_PROCESSES=glow-api,dyson,milesight`
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

## Termux:Boot restart after tablet reboot

Install the separate `Termux:Boot` app from the same source as Termux, then
open the Termux:Boot app once so Android grants it boot-start permission.

After that, install the WBPAI boot launcher from Termux:

```sh
cd ~/WBPAI
git pull origin main
sh scripts/termux-install-boot.sh
```

Reboot the tablet, wait a minute, then check:

```sh
tmux ls
tail -n 80 ~/WBPAI/logs/boot.log
tail -n 80 ~/WBPAI/logs/collectors.log
```

The `wbpai` tmux session should exist and the collectors should resume without
opening Termux manually.

To configure the house tablet after the repo is already cloned and `backend/.env`
already contains Supabase and Glow credentials:

```sh
cd ~/WBPAI
git pull origin main
sh scripts/termux-config-home-tablet.sh
```

That sets the tablet to `COLLECTOR_INSTANCE=home-tablet` and uses Glow API
polling for home electricity, home gas, and museum electricity.

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
COLLECTOR_PROCESSES=glow-api
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

Home Dyson purifier IAQ:

```env
BUILDING_ID=home
COLLECTOR_INSTANCE=home-tablet
COLLECTOR_PROCESSES=glow-api,dyson
DYSON_DEVICES=downstairs:192.168.1.50:438:DYSON-SERIAL:DYSON-LOCAL-PASSWORD,upstairs:192.168.1.51:438:DYSON-SERIAL:DYSON-LOCAL-PASSWORD
DYSON_POLL_INTERVAL_MS=60000
DYSON_SAVE_INTERVAL_MS=60000
```

`DYSON_DEVICES` is comma-separated. Each device uses:

```text
friendly-name:local-ip:product-code:serial:local-mqtt-password
```

The collector averages the available purifier IAQ values into one `home` row in
`Readings`. It maps Dyson temperature, humidity, PM2.5 and VOC-style values
where the model exposes them. Most Dyson purifiers do not provide CO2, so the
house still needs a separate CO2 monitor for a complete ventilation picture.

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

## Glow historical backfill

The always-on Glow collector only polls current daily/live readings. To pull
the historical Bright/Glow half-hour data that is still available from the API,
run the backfill manually from `backend/`.

First run the optional duplicate guard SQL in Supabase:

```sql
create unique index if not exists energy_readings_unique_source_interval
on public."EnergyReadings" (
  building_id,
  fuel_type,
  reading_type,
  "timestamp"
)
where reading_type = 'interval_30m';
```

Then run a bounded test import:

```sh
GLOW_HISTORY_FROM=2026-06-01 GLOW_HISTORY_TO=2026-06-03 npm run backfill:glow-history
```

For the full available history, widen `GLOW_HISTORY_FROM`. The script requests
`PT30M` readings in chunks, skips existing timestamps for the same building and
fuel, and writes rows with `reading_type=interval_30m`.

## Supabase requirement

The shared architecture expects `Readings` to include a nullable text column:

```sql
alter table "Readings"
add column if not exists building_id text;
```

Collectors should write `museum` or `home` so the dashboard can keep health,
weather and energy readings scoped to the active building.

If `DailyEnergyTotals` is a view, update it to include or group by `building_id`
before relying on home energy averages.
