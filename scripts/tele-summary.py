# Resumen de telemetria de camaras. Solo imprime estado de senal, sin secretos.
import json

with open('/tmp/tele.json', encoding='utf-8') as f:
    d = json.load(f)

for t in d.get('telemetry', []):
    print('---')
    print('serial:', t.get('serial'))
    print('name:', t.get('name'))
    print('status:', t.get('status'))
    print('signal:', t.get('signalPercent'), t.get('signalDbm'), t.get('signalQualityLabel'))
    print('ssid:', t.get('wifiSsid'))
    print('needsRepeater:', t.get('needsRepeater'))
    print('repeaterRecommendation:', t.get('repeaterRecommendation'))
    print('lastSnapshotAgeSec:', t.get('lastSnapshotAgeSec'))
    print('firmware:', t.get('firmware'))
    print('hasSdCard:', t.get('hasSdCard'))
