const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const withAndroidAppLocalization = (config) => {
  // Modify the Android manifest to use localized app name
  config = withAndroidManifest(config, (config) => {
    const mainApplication = config.modResults.manifest.application?.[0];
    
    if (mainApplication) {
      // Set the app label to reference the localized string resource
      mainApplication.$['android:label'] = '@string/app_name';
    }
    
    return config;
  });

  // Copy string resources to the Android project
  config = withDangerousMod(config, [
    'android',
    async (config) => {
      const projectRoot = config.modRequest.projectRoot;
      const androidProjectPath = config.modRequest.platformProjectRoot;
      
      // Create values directories and copy string resources
      const locales = [
        { dir: 'values', name: 'CraveCatch - Find your dish' },
        { dir: 'values-ja', name: 'なに食べよ' }
      ];
      
      for (const locale of locales) {
        const valuesDir = path.join(androidProjectPath, 'app/src/main/res', locale.dir);
        const stringsFile = path.join(valuesDir, 'strings.xml');
        
        // Create directory if it doesn't exist
        if (!fs.existsSync(valuesDir)) {
          fs.mkdirSync(valuesDir, { recursive: true });
        }
        
        // Create strings.xml file
        const stringsContent = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${locale.name}</string>
</resources>`;
        
        fs.writeFileSync(stringsFile, stringsContent);
      }
      
      return config;
    },
  ]);

  return config;
};

module.exports = withAndroidAppLocalization;