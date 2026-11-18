pipeline {
    agent any

    environment {
        NODE_ENV = 'testing'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Instalar dependencias Backend') {
            steps {
                bat '''
                    cd backend
                    npm ci
                '''
            }
        }

        stage('Ejecutar pruebas BDD Cucumber') {
            steps {
                bat '''
                    cd backend
                    npm run test:bdd
                '''
            }
        }

        stage('Archivar reporte Cucumber') {
            steps {
                archiveArtifacts artifacts: 'backend/bdd/reports/cucumber.json', fingerprint: true
            }
        }
    }

    post {
        failure {
            echo 'El pipeline fallo. Revisar la etapa indicada arriba.'
        }
        always {
            echo 'Pipeline de pruebas BDD finalizado.'
        }
    }
}
