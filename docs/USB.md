# USB ve seri port desteği

EVREN Desktop, bağlı USB aygıtlarını sorgulamak ve seri port üzerinden programlama
yapmak için iki araç sunar.

## `usb_devices`

Yapılandırılmış USB envanteri döndürür:

- USB aygıtları (ad, durum, VID/PID, instance ID)
- Seri portlar (`COM5`, `/dev/ttyUSB0` vb.)
- USB diskler
- ADB cihazları
- Python / pyserial / esptool sürümleri

`filter` ile ada, VID/PID'ye veya instance ID'ye göre daraltılabilir:

```text
usb_devices filter=2357
usb_devices filter=CP210
```

## `run_python`

Python kodunu geçici bir `.py` dosyasına yazar ve çalıştırır. Tırnak kaçışı
sorunu olmadan çok satırlı kod çalıştırmak için kullanılır.

```python
import serial.tools.list_ports as lp

for port in lp.comports():
    print(port.device, port.description, port.hwid)
```

```python
import serial

with serial.Serial("COM5", 115200, timeout=2) as port:
    port.write(b"AT\r\n")
    print(port.readline())
```

## Windows notları

- Komutlar UTF-8 çıktı verecek şekilde yapılandırılır; Türkçe karakterler bozulmaz.
- Seri port başka bir programda açıksa `PermissionError` alınır; portu serbest bırakın.
- Sürücü gerektiren aygıtlarda önce üretici sürücüsünü kurun.

## Linux / Pardus notları

- Seri port erişimi için kullanıcı `dialout` grubunda olmalı:
  `sudo usermod -aG dialout $USER`
- `lsusb`, `lsblk`, `python3-serial` kurulu olmalı.
- AppImage sandbox'ı nedeniyle cihaz erişimi kısıtlıysa `.deb` sürümünü kullanın.

## Güvenlik

- USB sorgusu salt okunur.
- `run_python` kod çalıştırdığı için `execute` izin kategorisindedir; confirm
  modunda onay istenir.
- Seri port yazma / firmware flash gibi işlemler geri alınamaz; doğru portu
  seçtiğinizden emin olun.
