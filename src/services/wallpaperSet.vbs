Dim WallpaperPath
WallpaperPath = "C:\Users\sama\Downloads\Wallpapers\wallpaper-1740395772543.jpg"

' Create WScript Shell object
Set WshShell = WScript.CreateObject("WScript.Shell")

' Set the wallpaper style (2 = stretched)
WshShell.RegWrite "HKCU\Control Panel\Desktop\WallpaperStyle", "2", "REG_SZ"
WshShell.RegWrite "HKCU\Control Panel\Desktop\TileWallpaper", "0", "REG_SZ"

' Set the wallpaper path
WshShell.RegWrite "HKCU\Control Panel\Desktop\Wallpaper", WallpaperPath, "REG_SZ"

' Force Windows to reload the desktop
WshShell.Run "%windir%\System32\RUNDLL32.EXE user32.dll,UpdatePerUserSystemParameters", 1, True