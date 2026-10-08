plugins {
  kotlin("jvm") version "2.0.21"
}

repositories { mavenCentral() }

dependencies {
  testImplementation(kotlin("test"))
}


sourceSets {
  main { kotlin.srcDir("../android/src/main/java/expo/modules/djidrone/control") }
  test { kotlin.srcDir("../android/src/test/java/expo/modules/djidrone/control") }
}

tasks.test {
  useJUnitPlatform()
  testLogging { events("passed", "failed"); exceptionFormat = org.gradle.api.tasks.testing.logging.TestExceptionFormat.FULL }
}
