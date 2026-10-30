plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Les pages de l'appli (salon, accueil, script injecté dans le lecteur) sont assemblées à chaque construction
// à partir du cœur commun du dépôt (coeur/, engine.js, panel.html) : une seule source pour l'extension et l'appli.
val pagesWeb = layout.buildDirectory.dir("generated/cowatch-web")
val depot = rootProject.projectDir.resolve("../..").canonicalFile
val assemblerWeb by tasks.registering(Exec::class) {
    inputs.dir(depot.resolve("coeur"))
    inputs.dir(depot.resolve("app/web"))
    inputs.files(depot.resolve("engine.js"), depot.resolve("panel.html"), depot.resolve("app/outils/assembler-web.sh"))
    outputs.dir(pagesWeb)
    commandLine("bash", depot.resolve("app/outils/assembler-web.sh").path, pagesWeb.get().dir("www").asFile.path)
}

android {
    namespace = "fr.cowatch.app"
    compileSdk = 35

    defaultConfig {
        // ⚠️ Identifiant définitif sur Google Play : à confirmer par Lucas avant la première publication.
        applicationId = "fr.cowatch.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 3
        versionName = "0.1.2"
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    sourceSets { getByName("main") { assets.srcDir(pagesWeb) } }
}

tasks.named("preBuild") { dependsOn(assemblerWeb) }

dependencies {
    // Aucune régie publicitaire, aucun kit de mesure : seulement les bibliothèques Android de base.
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
}
