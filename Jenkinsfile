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
                withCredentials([
                    string(credentialsId: 'jenkins-session-secret', variable: 'SESSION_SECRET'),
                ]) {
                    bat '''
                        cd backend
                        set DATABASE_URL=postgresql://test:test@localhost:5432/denuncias_test
                        npm run test:bdd
                    '''
                }
            }
        }

        stage('Archivar reportes Cucumber') {
            steps {
                archiveArtifacts artifacts: 'backend/bdd/reports/cucumber.json, backend/bdd/reports/cucumber.html', fingerprint: true
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
