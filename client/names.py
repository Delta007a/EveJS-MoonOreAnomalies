# Transient Python 2.7/3 module. Never saved into the EVE client.
import hashlib

FINGERPRINTS = {'GetScanName': '3286e1a302b50be844525d23cc9283b1a780bd58cdfa80bb94a42d5150ed8b66',
                'GetDungeonName': 'cc42afd17a295a19902783db25c5269edfd368f9e4f9a422bc8a5eab08b2586e'}
SCANNER_FINGERPRINTS = {
    'GetDisplayName': 'b2cb8fddc733adce6e89566e457cf25a9e08c2c16b3f8ff8c4d964dbac73fae6',
    'GetTypeName': 'edb9dbe21ad5ae61daa05b264e0b0ffb7de8f55ebeb484a9461ce6690c557678'}
BRACKET_FINGERPRINT = '18f902fdd4776af4d94136cdf5566a2120bf8d47d680decc0c913863bbca1352'

class NamePatch(object):
    def __init__(self, cls, names, scan_cls=None, bracket_cls=None):
        self.cls, self.names, self.originals, self.wrappers = cls, names, {}, {}
        self.scan_cls, self.bracket_cls = scan_cls, bracket_cls
        self.installed = []

    def checked(self, cls, name, expected):
        fn = getattr(cls, name)
        fn = getattr(fn, 'im_func', fn)
        code = getattr(fn, 'func_code', getattr(fn, '__code__', None))
        if code is None or hashlib.sha256(code.co_code).hexdigest() != expected:
            raise ValueError('Unsupported Moon name seam: ' + name)
        return fn

    def replace(self, cls, name, original, wrapper):
        setattr(cls, name, wrapper)
        self.installed.append((cls, name, original, wrapper))

    def install(self):
        for name, expected in FINGERPRINTS.items():
            self.originals[name] = self.checked(self.cls, name, expected)
        scanner = {}
        if self.scan_cls is not None:
            scanner = dict((name, self.checked(self.scan_cls, name, expected))
                           for name, expected in SCANNER_FINGERPRINTS.items())
        bracket = None
        if self.bracket_cls is not None:
            bracket = self.checked(self.bracket_cls, 'ApplyAttributes', BRACKET_FINGERPRINT)
        # Every required seam is verified before the first mutation.
        owner = self
        def key(site):
            dungeon_id = getattr(site, 'dungeonID', None)
            message_id = getattr(site, 'dungeonNameID', None)
            row = owner.names.get(dungeon_id)
            if row is not None and message_id in (row[1], dungeon_id):
                return dungeon_id
            # The native scanner projection carries only the name token.
            if dungeon_id in (None, 0) and message_id in owner.names:
                return message_id
            return None
        def get_dungeon(site):
            found = key(site)
            return owner.names[found][0] if found is not None else owner.originals['GetDungeonName'](site)
        def get_scan(site):
            found = key(site)
            return (found, owner.names[found][0]) if found is not None else owner.originals['GetScanName'](site)
        self.wrappers = {'GetDungeonName': get_dungeon, 'GetScanName': get_scan}
        for name, fn in self.wrappers.items():
            self.replace(self.cls, name, self.originals[name], fn)
        def scanner_wrapper(original):
            def wrapped(service, result):
                found = key(result)
                return owner.names[found][0] if found is not None else original(service, result)
            return wrapped
        for name, original in scanner.items():
            self.replace(self.scan_cls, name, original, scanner_wrapper(original))
        if bracket is not None:
            native = getattr(bracket, 'func_globals', getattr(bracket, '__globals__', {}))
            # Exact reviewed method: base.ApplyAttributes, then UpdateSiteName.
            # Calling the old whole method would localize a private token first.
            def apply_attributes(widget, attributes):
                native['SensorSuiteBracket'].ApplyAttributes(widget, attributes)
                found = key(widget.data)
                label = owner.names[found][0] if found is not None else native['localization'].GetByMessageID(widget.data.dungeonNameID)
                widget.UpdateSiteName(label)
            self.replace(self.bracket_cls, 'ApplyAttributes', bracket, apply_attributes)

    def dispose(self):
        for cls, name, original, fn in reversed(self.installed):
            current = getattr(cls, name)
            if getattr(current, 'im_func', current) is fn:
                setattr(cls, name, original)
        self.installed = []

def start(names, context):
    import __builtin__ as builtins
    import uthread
    import blue
    build = int(getattr(context.get('boot', getattr(builtins, 'boot', None)), 'build', 0))
    print('MOON_NAMES:DELIVERED:build=%s' % build)
    key = '_evejs_moon_transient_names'
    old = getattr(builtins, key, None)
    if old is not None:
        old.OnDisconnect()
    class Owner(object):
        patch = None
        active = True
        manager = None
        character = None
        def OnDisconnect(self, *args):
            self.active = False
            if self.patch:
                self.patch.dispose()
                self.patch = None
            if self.manager:
                for event in ('OnDisconnect', 'OnSessionChanged'):
                    try:
                        self.manager.UnregisterForNotifyEvent(self, event)
                    except Exception:
                        pass
                self.manager = None
        def OnSessionChanged(self, *args):
            session = context.get('session', getattr(builtins, 'session', None))
            if getattr(session, 'charid', None) != self.character:
                self.OnDisconnect()
        def run(self):
            try:
                if build != 3396210:
                    print('MOON_NAMES:UNSUPPORTED_BUILD')
                    return
                for attempt in range(240):
                    if not self.active or getattr(builtins, key, None) is not self:
                        return
                    session = context.get('session', getattr(builtins, 'session', None))
                    manager = context.get('sm', getattr(builtins, 'sm', None))
                    if manager is not None and getattr(session, 'charid', None):
                        from sensorsuite.overlay.scannablesitedata import ScannableSiteData
                        from eve.client.script.parklife.scanSvc import ScanSvc
                        from sensorsuite.overlay.anomalies import AnomalyBracket
                        self.patch = NamePatch(ScannableSiteData, names, ScanSvc, AnomalyBracket)
                        self.patch.install()
                        self.character = session.charid
                        self.manager = manager
                        for event in ('OnDisconnect', 'OnSessionChanged'):
                            manager.RegisterForNotifyEvent(self, event)
                        print('MOON_NAMES:READY')
                        return
                    blue.pyos.synchro.SleepWallclock(500)
            except Exception as error:
                self.OnDisconnect()
                print('MOON_NAMES:UNAVAILABLE:%s' % type(error).__name__)
    owner = Owner()
    setattr(builtins, key, owner)
    uthread.new(owner.run)
