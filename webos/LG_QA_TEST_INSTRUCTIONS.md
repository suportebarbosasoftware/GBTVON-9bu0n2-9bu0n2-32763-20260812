# GBTVON — LG webOS QA Test Instructions

## Application

- Application title: **GBTVON**
- Application ID: **com.gbtvon.streaming**
- Package: **com.gbtvon.streaming_1.1.0_all.ipk**
- Category: Entertainment / Media player
- Supported device: LG webOS TV

## Purpose

GBTVON is a media player. It does not provide, host, sell, retransmit, or manage third-party playlists or media. Users are responsible for adding and using only content for which they have the necessary rights or authorization.

For store review, the application includes an isolated demonstration mode with a short video packaged inside the app. It does not use, expose, or require any customer account, customer playlist, or external streaming server.

## Test Access

1. Open GBTVON.
2. On the login screen, enter any name, for example: `LG QA`.
3. Enter representative code: `9999`.
4. Select **Solicitar Ativação**.
5. Read the Terms of Use and select **Aceitar e continuar**.

The application opens directly in the demo catalog. No personal channel setup, external activation, payment, or administrator credentials are required for this QA flow.

## Demo Content

The demo profile contains demonstration media only:

- One demo channel in **TV ao Vivo**
- Three sample videos in **Filmes**
- One sample series with two episodes in **Séries**

## Recommended QA Flow

### 1. Basic navigation

Use the remote D-pad to move among **TV ao Vivo**, **Filmes**, **Séries**, and **Perfil**. Press OK to select an item. The Back key returns from playback to the catalog.

### 2. Live TV

1. Open **TV ao Vivo** and select **Canal de Demonstração**.
2. Verify video playback.
3. While playing, press OK to open the channel list and Back to return to the catalog.

### 3. Movies

1. Open **Filmes** and select a demo video.
2. During playback, Left/Right seek backward/forward; OK pauses or resumes; Down displays playback controls; Back exits playback.
3. On a movie card, hold OK for about one second to add or remove it from **Favoritos**.
4. Open the search control and verify that results filter while each character is entered.

### 4. Series

1. Open **Séries** and select **Série de Demonstração**.
2. Start episode 1 and confirm that episode 2 begins automatically after completion.
3. Exit and reopen the series to verify resume/progress information.
4. Hold OK on the series card to add or remove it from **Favoritos**.

### 5. Terms of Use

The Terms of Use dialog is required before content is available. Selecting **Não aceito** signs the user out; selecting **Aceitar e continuar** stores the acceptance for that user on the device.

## Support Contact

- Telephone: +55 (79) 99900-1094
- Seller support email: provided in LG Seller Lounge submission
